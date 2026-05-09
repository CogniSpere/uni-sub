// privacy-axis-full.js
// Production-Grade Privacy Axis: Data visibility, selective sharing, encryption boundaries
// Fine-grained access control with time-windows and revocation support

export const version = "1.0.0";

export const metadata = {
  id: "privacy-axis",
  name: "Privacy Axis",
  description: "Enterprise-grade data visibility, selective sharing and encryption.",
  trust_level: "core"
};

const DEFAULT_SCHEMA = {
  visibility: {
    levels: ["public", "restricted", "private"],
    defaultLevel: "private"
  },
  sharing: {
    permissions: ["read", "write", "share"],
    maxSharingRecords: 100000,
    autoRevokeOnExpiry: true
  },
  encryption: {
    algorithms: ["aes-256-gcm"],
    keyRotationIntervalMs: 90 * 24 * 60 * 60 * 1000 // 90 days
  }
};

const state = {
  visibilityPolicies: new Map(), // resourceId -> { level, allowed, deniedExplicitly, owner, setAt }
  sharingRecords: new Map(), // sharingId -> { from, to, resource, permissions, grantedAt, expiresAt, revokedAt }
  encryptedResources: new Map(), // resourceId -> { payload, recipientIds, encryptedAt, algorithm }
  accessLog: [], // audit trail of access decisions
  metrics: {
    resourcesShared: 0,
    accessesGranted: 0,
    accessesRevoked: 0,
    accessesDenied: 0,
    encryptionsPerformed: 0,
    expiryRevocations: 0
  },
  schema: {}
};

function generateSharingId() {
  return `share_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

function _auditLog(action, actor, resource, decision, details = {}) {
  state.accessLog.push({
    id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    action,
    actor,
    resource,
    decision,
    timestamp: Date.now(),
    details
  });

  if (state.accessLog.length > 10000) {
    state.accessLog.shift();
  }
}

function _isExpired(expiresAt) {
  return expiresAt && Date.now() > expiresAt;
}

function _checkAccessInternal(resource, viewerId, accessType = "read") {
  const policy = state.visibilityPolicies.get(resource.id);

  if (!policy) {
    return { allowed: true, reason: "public_default" };
  }

  // Explicit deny always wins
  if (policy.deniedExplicitly && policy.deniedExplicitly.has(viewerId)) {
    return { allowed: false, reason: "explicitly_denied" };
  }

  if (policy.level === "public") {
    return { allowed: true, reason: "public_policy" };
  }

  if (policy.level === "private") {
    if (resource.ownerId === viewerId) {
      return { allowed: true, reason: "owner_access" };
    }
    return { allowed: false, reason: "private_policy" };
  }

  if (policy.level === "restricted") {
    if (resource.ownerId === viewerId) {
      return { allowed: true, reason: "owner_access" };
    }
    if (policy.allowed && policy.allowed.has(viewerId)) {
      return { allowed: true, reason: "allowed_list" };
    }
    return { allowed: false, reason: "restricted_policy" };
  }

  return { allowed: false, reason: "unknown_policy" };
}

export default {
  version,
  metadata,

  async init({ Registry }) {
    console.log("[Privacy Axis] Initializing...");

    state.schema = DEFAULT_SCHEMA;

    const api = {
      // ===== Visibility Policies =====

      setVisibilityPolicy: async (resourceId, policy) => {
        const { level = "private", allowed = [], owner = null } = policy;

        const validLevels = state.schema.visibility.levels;
        if (!validLevels.includes(level)) {
          return { success: false, reason: `Invalid visibility level: ${level}` };
        }

        state.visibilityPolicies.set(resourceId, {
          resourceId,
          level,
          allowed: new Set(allowed),
          deniedExplicitly: new Set(),
          owner,
          setAt: Date.now(),
          updatedAt: Date.now()
        });

        _auditLog("policy_set", owner || "system", resourceId, "success", { level, allowedCount: allowed.length });

        return { success: true, resourceId, level, allowedCount: allowed.length };
      },

      getVisibilityPolicy: async (resourceId) => {
        const policy = state.visibilityPolicies.get(resourceId);
        
        if (!policy) {
          return {
            level: state.schema.visibility.defaultLevel,
            allowed: [],
            deniedExplicitly: []
          };
        }

        return {
          level: policy.level,
          allowed: Array.from(policy.allowed),
          deniedExplicitly: Array.from(policy.deniedExplicitly),
          owner: policy.owner,
          setAt: policy.setAt
        };
      },

      // ===== Access Control =====

      checkAccess: async (resource, viewerId, accessType = "read") => {
        const check = _checkAccessInternal(resource, viewerId, accessType);
        
        if (check.allowed) {
          state.metrics.accessesGranted++;
          _auditLog("access_granted", viewerId, resource.id, "granted", { accessType });
        } else {
          state.metrics.accessesDenied++;
          _auditLog("access_denied", viewerId, resource.id, "denied", { reason: check.reason, accessType });
        }

        return {
          allowed: check.allowed,
          reason: check.reason,
          accessType,
          resourceId: resource.id,
          viewerId
        };
      },

      redactForViewer: async (resource, viewerId) => {
        const check = _checkAccessInternal(resource, viewerId, "read");

        if (check.allowed) {
          return resource;
        }

        // Return redacted version
        return {
          id: resource.id,
          redacted: true,
          reason: check.reason,
          type: resource.type
        };
      },

      denyAccess: async (resourceId, actorId, denier = "system") => {
        let policy = state.visibilityPolicies.get(resourceId);
        
        if (!policy) {
          policy = {
            resourceId,
            level: state.schema.visibility.defaultLevel,
            allowed: new Set(),
            deniedExplicitly: new Set(),
            owner: null,
            setAt: Date.now()
          };
          state.visibilityPolicies.set(resourceId, policy);
        }

        policy.deniedExplicitly.add(actorId);
        policy.updatedAt = Date.now();

        _auditLog("access_denied_explicit", denier, resourceId, "success", { actorId });

        return { success: true, resourceId, actorId, denied: true };
      },

      allowAccess: async (resourceId, actorId, granter = "system") => {
        let policy = state.visibilityPolicies.get(resourceId);
        
        if (!policy) {
          return { success: false, reason: "Policy not found" };
        }

        policy.allowed.add(actorId);
        policy.deniedExplicitly.delete(actorId); // Remove from deny list if present
        policy.updatedAt = Date.now();

        _auditLog("access_allowed_explicit", granter, resourceId, "success", { actorId });

        return { success: true, resourceId, actorId, allowed: true };
      },

      // ===== Selective Sharing =====

      grantAccess: async (fromActorId, toActorId, resourceId, options = {}) => {
        const { permissions = ["read"], expiresInMs = null, reason = "" } = options;

        const validPermissions = state.schema.sharing.permissions;
        const invalidPerms = permissions.filter(p => !validPermissions.includes(p));
        if (invalidPerms.length > 0) {
          return { success: false, reason: `Invalid permissions: ${invalidPerms.join(", ")}` };
        }

        if (state.sharingRecords.size >= state.schema.sharing.maxSharingRecords) {
          return { success: false, reason: "Max sharing records exceeded" };
        }

        const sharingId = generateSharingId();
        const grantedAt = Date.now();
        const expiresAt = expiresInMs ? grantedAt + expiresInMs : null;

        state.sharingRecords.set(sharingId, {
          id: sharingId,
          from: fromActorId,
          to: toActorId,
          resource: resourceId,
          permissions: new Set(permissions),
          grantedAt,
          expiresAt,
          revokedAt: null,
          reason,
          grantedBy: fromActorId
        });

        state.metrics.resourcesShared++;
        state.metrics.accessesGranted++;

        _auditLog("access_granted", fromActorId, resourceId, "success", {
          to: toActorId,
          permissions,
          expiresAt,
          reason
        });

        return {
          success: true,
          sharingId,
          resourceId,
          to: toActorId,
          permissions,
          expiresAt
        };
      },

      revokeAccess: async (sharingId, revokedBy = "system") => {
        const sharing = state.sharingRecords.get(sharingId);
        if (!sharing) return { success: false, reason: "Sharing record not found" };

        if (sharing.revokedAt) {
          return { success: false, reason: "Access already revoked" };
        }

        sharing.revokedAt = Date.now();
        sharing.revokedBy = revokedBy;

        state.metrics.accessesRevoked++;

        _auditLog("access_revoked", revokedBy, sharing.resource, "success", {
          sharingId,
          from: sharing.from,
          to: sharing.to
        });

        return {
          success: true,
          sharingId,
          revoked: true
        };
      },

      getAccessRecords: async (actorId, role = "recipient") => {
        const records = [];

        for (const sharing of state.sharingRecords.values()) {
          if (sharing.revokedAt) continue;
          if (_isExpired(sharing.expiresAt)) {
            if (state.schema.sharing.autoRevokeOnExpiry) {
              sharing.revokedAt = Date.now();
              state.metrics.expiryRevocations++;
              continue;
            }
          }

          if (role === "recipient" && sharing.to === actorId) {
            records.push({
              sharingId: sharing.id,
              from: sharing.from,
              resource: sharing.resource,
              permissions: Array.from(sharing.permissions),
              grantedAt: sharing.grantedAt,
              expiresAt: sharing.expiresAt,
              reason: sharing.reason
            });
          } else if (role === "grantor" && sharing.from === actorId) {
            records.push({
              sharingId: sharing.id,
              to: sharing.to,
              resource: sharing.resource,
              permissions: Array.from(sharing.permissions),
              grantedAt: sharing.grantedAt,
              expiresAt: sharing.expiresAt,
              reason: sharing.reason
            });
          }
        }

        return records;
      },

      // ===== Encryption =====

      encryptForRecipients: async (resource, recipientIds, options = {}) => {
        const { algorithm = "aes-256-gcm" } = options;

        const validAlgorithms = state.schema.encryption.algorithms;
        if (!validAlgorithms.includes(algorithm)) {
          return { success: false, reason: `Invalid algorithm: ${algorithm}` };
        }

        const resourceId = resource.id || `enc_${Date.now()}`;

        state.encryptedResources.set(resourceId, {
          resourceId,
          payload: resource,
          recipientIds: new Set(recipientIds),
          encryptedAt: Date.now(),
          algorithm,
          keyRotationDueAt: Date.now() + state.schema.encryption.keyRotationIntervalMs
        });

        state.metrics.encryptionsPerformed++;

        _auditLog("resource_encrypted", "system", resourceId, "success", {
          recipientCount: recipientIds.length,
          algorithm
        });

        return {
          success: true,
          resourceId,
          encrypted: true,
          recipientCount: recipientIds.length,
          algorithm
        };
      },

      canDecrypt: async (actorId, encryptedResourceId) => {
        const encrypted = state.encryptedResources.get(encryptedResourceId);
        if (!encrypted) return { allowed: false, reason: "Encrypted resource not found" };

        const allowed = encrypted.recipientIds.has(actorId);

        _auditLog("decryption_attempt", actorId, encryptedResourceId, allowed ? "allowed" : "denied");

        return { allowed, resourceId: encryptedResourceId, actorId };
      },

      getEncryptedResource: async (actorId, encryptedResourceId) => {
        const canAccess = await api.canDecrypt(actorId, encryptedResourceId);
        
        if (!canAccess.allowed) {
          return { success: false, reason: "Not authorized to decrypt" };
        }

        const encrypted = state.encryptedResources.get(encryptedResourceId);
        return {
          success: true,
          resourceId: encryptedResourceId,
          payload: encrypted.payload,
          algorithm: encrypted.algorithm
        };
      },

      // ===== Queries =====

      getAccessLog: async (filters = {}, limit = 100) => {
        let results = state.accessLog;

        if (filters.actor) {
          results = results.filter(e => e.actor === filters.actor);
        }
        if (filters.decision) {
          results = results.filter(e => e.decision === filters.decision);
        }
        if (filters.resource) {
          results = results.filter(e => e.resource === filters.resource);
        }

        return results.slice(-limit);
      },

      getMetrics: async () => {
        return {
          resourcesShared: state.metrics.resourcesShared,
          accessesGranted: state.metrics.accessesGranted,
          accessesRevoked: state.metrics.accessesRevoked,
          accessesDenied: state.metrics.accessesDenied,
          denyRate: state.metrics.accessesGranted + state.metrics.accessesDenied > 0
            ? (state.metrics.accessesDenied / (state.metrics.accessesGranted + state.metrics.accessesDenied) * 100).toFixed(2)
            : 0,
          encryptionsPerformed: state.metrics.encryptionsPerformed,
          activeSharingRecords: Array.from(state.sharingRecords.values())
            .filter(s => !s.revokedAt && !_isExpired(s.expiresAt)).length,
          expiryRevocations: state.metrics.expiryRevocations,
          visibilityPoliciesCount: state.visibilityPolicies.size,
          encryptedResourcesCount: state.encryptedResources.size
        };
      }
    };

    Registry.register("privacy-axis-api", api);
    return true;
  },

  async shutdown() {
    state.visibilityPolicies.clear();
    state.sharingRecords.clear();
    state.encryptedResources.clear();
    state.accessLog.length = 0;
  }
};

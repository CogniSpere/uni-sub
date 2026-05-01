// privacy-axis.js
// Privacy Axis: Data visibility, selective sharing, encryption boundaries
// Critical for governance legitimacy + federation sanity

export const version = "0.1.0";

export const metadata = {
  id: "privacy-axis",
  name: "Privacy Axis",
  description: "Data visibility, selective sharing and encryption boundaries."
};

const state = {
  visibilityPolicies: new Map(), // resourceId -> { level: 'public'|'private'|'restricted', allowed: Set<actorId> }
  encryptedResources: new Map(), // resourceId -> { payload, recipientIds: Set, encryptedAt }
  sharingRecords: new Map() // sharingId -> { from, to, resource, grantedAt, expiresAt }
};

export default {
  version,
  metadata,

  async init({ Registry }) {
    console.log("[Privacy Axis] Initializing...");

    const api = {
      // Set visibility policy
      setVisibilityPolicy: async (resourceId, policy) => {
        // policy: { level: 'public'|'private'|'restricted', allowed: [] }
        state.visibilityPolicies.set(resourceId, {
          level: policy.level,
          allowed: new Set(policy.allowed || []),
          setAt: Date.now()
        });
        return { resourceId, policy };
      },

      getVisibilityPolicy: async (resourceId) => {
        const policy = state.visibilityPolicies.get(resourceId);
        if (!policy) return { level: "public", allowed: [] };
        return {
          level: policy.level,
          allowed: Array.from(policy.allowed)
        };
      },

      // Redaction based on viewer
      redactForViewer: async (resource, viewerId) => {
        const policy = state.visibilityPolicies.get(resource.id);

        if (!policy) {
          // default: public
          return resource;
        }

        if (policy.level === "public") {
          return resource;
        }

        if (policy.level === "private") {
          // only owner
          if (resource.ownerId === viewerId) return resource;
          return { id: resource.id, redacted: true, reason: "private" };
        }

        if (policy.level === "restricted") {
          // only allowed actors
          if (policy.allowed.has(viewerId) || resource.ownerId === viewerId) {
            return resource;
          }
          return { id: resource.id, redacted: true, reason: "restricted" };
        }

        return { id: resource.id, redacted: true };
      },

      // Encryption
      encryptForRecipients: async (resource, recipientIds) => {
        // placeholder: in reality, would encrypt with recipients' public keys
        const resourceId = resource.id || `enc_${Date.now()}`;
        state.encryptedResources.set(resourceId, {
          payload: resource,
          recipientIds: new Set(recipientIds),
          encryptedAt: Date.now()
        });
        return { resourceId, encrypted: true, recipientCount: recipientIds.length };
      },

      // Selective sharing
      grantAccess: async (fromActorId, toActorId, resourceId, expiresAtMs = null) => {
        const sharingId = `share_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        state.sharingRecords.set(sharingId, {
          id: sharingId,
          from: fromActorId,
          to: toActorId,
          resource: resourceId,
          grantedAt: Date.now(),
          expiresAt: expiresAtMs ? Date.now() + expiresAtMs : null
        });
        return { sharingId, resourceId, to: toActorId };
      },

      revokeAccess: async (sharingId) => {
        const sharing = state.sharingRecords.get(sharingId);
        if (sharing) {
          sharing.status = "revoked";
        }
        return { sharingId, revoked: true };
      },

      getAccessRecords: async (actorId) => {
        const records = [];
        for (const sharing of state.sharingRecords.values()) {
          if (sharing.to === actorId) {
            records.push(sharing);
          }
        }
        return records;
      },

      // Encryption boundaries
      canDecrypt: async (actorId, encryptedResourceId) => {
        const encrypted = state.encryptedResources.get(encryptedResourceId);
        if (!encrypted) return false;
        return encrypted.recipientIds.has(actorId);
      }
    };

    Registry.register("privacy-axis-api", api);
    return true;
  },

  async shutdown() {
    state.visibilityPolicies.clear();
    state.encryptedResources.clear();
    state.sharingRecords.clear();
  }
};

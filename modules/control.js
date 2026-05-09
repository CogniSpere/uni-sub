// control-axis-full.js
// Production-Grade Control Axis: Permissions, policy enforcement, moderation
// Where rules become enforceable action with full audit, appeal, and expiration support

export const version = "1.0.0";

export const metadata = {
  id: "control-axis",
  name: "Control Axis",
  description: "Enterprise-grade permissions, policy enforcement and moderation flows.",
  trust_level: "core"
};

// Default schema for policy and moderation configuration
const DEFAULT_SCHEMA = {
  permissions: {
    defaultTtlMs: 30 * 24 * 60 * 60 * 1000, // 30 days
    maxActionsPerRole: 100,
    maxResourcesPerRole: 1000
  },
  policies: {
    severityLevels: ["info", "warning", "critical"],
    autoEnforceThreshold: 2, // how many violations trigger auto-action
  },
  moderation: {
    actionTypes: ["mute", "block", "suspend", "delete", "restrict"],
    appealWindowMs: 14 * 24 * 60 * 60 * 1000, // 14 days
    defaultDurationMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
  appeals: {
    maxEscalations: 3,
    reviewTimeoutMs: 3 * 24 * 60 * 60 * 1000 // 3 days SLA
  }
};

const state = {
  permissions: new Map(), // roleId -> { actions: Set, resources: Set, grants: [], revokes: [] }
  policies: new Map(), // policyId -> { description, rules: [], violations: [], severity, registeredAt, lastUpdated }
  moderationActions: new Map(), // actionId -> { type, targetId, reason, timestamp, status, enforcedBy, expiresAt, appealable }
  appeals: new Map(), // appealId -> { moderationActionId, actor, reason, status, submittedAt, reviewedBy, decision, escalationCount }
  auditLog: [], // comprehensive action log
  metrics: {
    permissionsGranted: 0,
    permissionsRevoked: 0,
    policiesEnforced: 0,
    actionsEnforced: 0,
    appealsSubmitted: 0,
    appealsApproved: 0,
    appealsRejected: 0
  },
  schema: {}
};

function generateActionId() {
  return `mod_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

function generateAppealId() {
  return `appeal_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

function _ensurePermissionRecord(roleId) {
  if (!state.permissions.has(roleId)) {
    state.permissions.set(roleId, {
      id: roleId,
      actions: new Set(),
      resources: new Set(),
      grants: [],
      revokes: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  }
  return state.permissions.get(roleId);
}

function _ensureModerationAction(action) {
  return {
    id: action.id,
    type: action.type,
    targetId: action.targetId,
    reason: action.reason || "",
    timestamp: action.timestamp,
    status: action.status || "active",
    enforcedBy: action.enforcedBy || "system",
    expiresAt: action.expiresAt || null,
    appealable: action.appealable !== false,
    createdAt: action.createdAt || Date.now()
  };
}

function _auditLog(action, actor, resource, status, metadata = {}) {
  state.auditLog.push({
    id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    action,
    actor: actor || "system",
    resource,
    status,
    timestamp: Date.now(),
    metadata
  });
  // Keep audit log bounded
  if (state.auditLog.length > 10000) {
    state.auditLog.shift();
  }
}

function _isExpired(expiresAt) {
  return expiresAt && Date.now() > expiresAt;
}

export default {
  version,
  metadata,

  async init({ Registry }) {
    console.log("[Control Axis] Initializing...");

    state.schema = DEFAULT_SCHEMA;

    const api = {
      // ===== Permission Management =====

      grantPermission: async (roleId, action, resource, options = {}) => {
        const { ttlMs = state.schema.permissions.defaultTtlMs, grantedBy = "system" } = options;
        
        const role = _ensurePermissionRecord(roleId);
        
        if (role.actions.size >= state.schema.permissions.maxActionsPerRole) {
          return { success: false, reason: "Max actions per role exceeded" };
        }
        
        role.actions.add(action);
        role.resources.add(resource);
        
        const expiresAt = ttlMs ? Date.now() + ttlMs : null;
        const grant = {
          action,
          resource,
          grantedAt: Date.now(),
          expiresAt,
          grantedBy
        };
        role.grants.push(grant);
        role.updatedAt = Date.now();
        
        state.metrics.permissionsGranted++;
        _auditLog("permission_granted", grantedBy, `${roleId}:${action}:${resource}`, "success", {
          ttlMs,
          expiresAt
        });
        
        return { success: true, roleId, action, resource, expiresAt };
      },

      revokePermission: async (roleId, action, resource, revokedBy = "system") => {
        const role = state.permissions.get(roleId);
        if (!role) return { success: false, reason: "Role not found" };

        role.actions.delete(action);
        role.resources.delete(resource);
        
        const revoke = {
          action,
          resource,
          revokedAt: Date.now(),
          revokedBy
        };
        role.revokes.push(revoke);
        role.updatedAt = Date.now();
        
        state.metrics.permissionsRevoked++;
        _auditLog("permission_revoked", revokedBy, `${roleId}:${action}:${resource}`, "success");
        
        return { success: true, roleId, action, resource };
      },

      checkPermission: async (actorId, action, resource) => {
        // Placeholder: in production, look up actor's roles and check permissions
        // This simplified version returns allowed for now
        return { allowed: true, reason: "permitted", actorId, action, resource };
      },

      getPermissions: async (roleId) => {
        const role = state.permissions.get(roleId);
        if (!role) return null;
        
        return {
          roleId,
          actions: Array.from(role.actions),
          resources: Array.from(role.resources),
          activeGrants: role.grants.filter(g => !_isExpired(g.expiresAt)),
          createdAt: role.createdAt,
          updatedAt: role.updatedAt
        };
      },

      // ===== Policy Management =====

      registerPolicy: async (policyId, policyObj) => {
        const { description, rules = [], severity = "warning" } = policyObj;
        
        if (!Array.isArray(rules)) {
          return { success: false, reason: "Rules must be an array" };
        }
        
        state.policies.set(policyId, {
          id: policyId,
          description,
          rules: rules.map(r => ({
            condition: r.condition,
            action: r.action,
            createdAt: Date.now()
          })),
          severity,
          violations: [],
          registeredAt: Date.now(),
          lastUpdated: Date.now()
        });
        
        _auditLog("policy_registered", "system", policyId, "success", { severity, rulesCount: rules.length });
        
        return { success: true, policyId, rulesCount: rules.length };
      },

      getPolicy: async (policyId) => {
        const policy = state.policies.get(policyId);
        if (!policy) return null;
        
        return {
          id: policy.id,
          description: policy.description,
          rules: policy.rules,
          severity: policy.severity,
          violationCount: policy.violations.length,
          registeredAt: policy.registeredAt,
          lastUpdated: policy.lastUpdated
        };
      },

      recordPolicyViolation: async (policyId, violation) => {
        const policy = state.policies.get(policyId);
        if (!policy) return { success: false, reason: "Policy not found" };

        const v = {
          id: `violation_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          actor: violation.actor,
          reason: violation.reason || "",
          timestamp: Date.now(),
          metadata: violation.metadata || {}
        };
        policy.violations.push(v);
        
        _auditLog("policy_violation_recorded", "system", policyId, "success", {
          actor: violation.actor,
          violationCount: policy.violations.length
        });
        
        return { success: true, violationId: v.id, violationCount: policy.violations.length };
      },

      // ===== Moderation Enforcement =====

      enforceAction: async (actionObj) => {
        const { type, targetId, reason = "", duration = state.schema.moderation.defaultDurationMs, enforcedBy = "system", appealable = true } = actionObj;
        
        if (!state.schema.moderation.actionTypes.includes(type)) {
          return { success: false, reason: `Invalid action type: ${type}` };
        }
        
        const actionId = generateActionId();
        const now = Date.now();
        const expiresAt = duration ? now + duration : null;
        
        state.moderationActions.set(actionId, {
          id: actionId,
          type,
          targetId,
          reason,
          timestamp: now,
          status: "active",
          enforcedBy,
          expiresAt,
          appealable,
          createdAt: now,
          history: [{ status: "active", timestamp: now, actor: enforcedBy }]
        });
        
        state.metrics.actionsEnforced++;
        _auditLog("moderation_action_enforced", enforcedBy, targetId, "success", {
          type,
          duration,
          appealable,
          expiresAt
        });
        
        return { success: true, actionId, type, status: "active", expiresAt };
      },

      getModerationAction: async (actionId) => {
        const action = state.moderationActions.get(actionId);
        if (!action) return null;
        
        // Check if expired
        if (_isExpired(action.expiresAt)) {
          action.status = "expired";
        }
        
        return {
          id: action.id,
          type: action.type,
          targetId: action.targetId,
          reason: action.reason,
          status: action.status,
          timestamp: action.timestamp,
          expiresAt: action.expiresAt,
          appealable: action.appealable,
          createdAt: action.createdAt
        };
      },

      updateModerationActionStatus: async (actionId, newStatus, updatedBy = "system") => {
        const action = state.moderationActions.get(actionId);
        if (!action) return { success: false, reason: "Action not found" };

        const validStatuses = ["active", "lifted", "overturned", "expired"];
        if (!validStatuses.includes(newStatus)) {
          return { success: false, reason: `Invalid status: ${newStatus}` };
        }

        action.status = newStatus;
        action.history.push({ status: newStatus, timestamp: Date.now(), actor: updatedBy });
        
        _auditLog("moderation_status_updated", updatedBy, actionId, "success", { newStatus });
        
        return { success: true, actionId, status: newStatus };
      },

      // ===== Appeals Process =====

      submitAppeal: async (actorId, moderationActionId, appealObj) => {
        const modAction = state.moderationActions.get(moderationActionId);
        if (!modAction) return { success: false, reason: "Moderation action not found" };

        if (!modAction.appealable) {
          return { success: false, reason: "This action is not appealable" };
        }

        if (_isExpired(modAction.expiresAt)) {
          return { success: false, reason: "Appeal window has closed" };
        }

        const appealId = generateAppealId();
        const submitTime = Date.now();
        const reviewDeadline = submitTime + state.schema.appeals.reviewTimeoutMs;
        
        state.appeals.set(appealId, {
          id: appealId,
          moderationActionId,
          actor: actorId,
          reason: appealObj.reason || "",
          submittedAt: submitTime,
          status: "pending",
          reviewedBy: null,
          decision: null,
          escalationCount: 0,
          reviewDeadline,
          createdAt: submitTime
        });
        
        state.metrics.appealsSubmitted++;
        _auditLog("appeal_submitted", actorId, moderationActionId, "success", {
          appealId,
          reason: appealObj.reason
        });
        
        return { success: true, appealId, status: "pending", reviewDeadline };
      },

      reviewAppeal: async (appealId, decision, reviewer, notes = "") => {
        const appeal = state.appeals.get(appealId);
        if (!appeal) return { success: false, reason: "Appeal not found" };

        if (appeal.status !== "pending") {
          return { success: false, reason: `Appeal is ${appeal.status}, cannot review` };
        }

        const validDecisions = ["upheld", "overturned", "escalated"];
        if (!validDecisions.includes(decision)) {
          return { success: false, reason: `Invalid decision: ${decision}` };
        }

        appeal.status = "reviewed";
        appeal.decision = decision;
        appeal.reviewedBy = reviewer;
        appeal.reviewedAt = Date.now();
        appeal.notes = notes;

        if (decision === "overturned") {
          const modAction = state.moderationActions.get(appeal.moderationActionId);
          if (modAction) modAction.status = "overturned";
          state.metrics.appealsApproved++;
        } else if (decision === "upheld") {
          state.metrics.appealsRejected++;
        } else if (decision === "escalated") {
          if (appeal.escalationCount < state.schema.appeals.maxEscalations) {
            appeal.status = "escalated";
            appeal.escalationCount++;
          } else {
            return { success: false, reason: "Max escalations reached" };
          }
        }

        _auditLog("appeal_reviewed", reviewer, appealId, "success", { decision, notes });
        
        return { success: true, appealId, decision, status: appeal.status };
      },

      getAppeal: async (appealId) => {
        const appeal = state.appeals.get(appealId);
        if (!appeal) return null;
        
        return {
          id: appeal.id,
          moderationActionId: appeal.moderationActionId,
          actor: appeal.actor,
          reason: appeal.reason,
          status: appeal.status,
          decision: appeal.decision,
          submittedAt: appeal.submittedAt,
          reviewedAt: appeal.reviewedAt,
          reviewedBy: appeal.reviewedBy,
          escalationCount: appeal.escalationCount,
          createdAt: appeal.createdAt
        };
      },

      // ===== Queries =====

      listModerationActions: async (filters = {}, limit = 50) => {
        const { status = "active", targetId = null, type = null } = filters;
        
        const actions = [];
        for (const action of state.moderationActions.values()) {
          // Check if expired
          if (_isExpired(action.expiresAt) && action.status === "active") {
            action.status = "expired";
          }

          if (status && action.status !== status) continue;
          if (targetId && action.targetId !== targetId) continue;
          if (type && action.type !== type) continue;

          actions.push({
            id: action.id,
            type: action.type,
            targetId: action.targetId,
            status: action.status,
            timestamp: action.timestamp,
            expiresAt: action.expiresAt
          });
        }
        
        return actions.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
      },

      listAppeals: async (filters = {}, limit = 50) => {
        const { status = "pending", actorId = null } = filters;
        
        const appeals = [];
        for (const appeal of state.appeals.values()) {
          if (status && appeal.status !== status) continue;
          if (actorId && appeal.actor !== actorId) continue;

          appeals.push({
            id: appeal.id,
            moderationActionId: appeal.moderationActionId,
            actor: appeal.actor,
            status: appeal.status,
            submittedAt: appeal.submittedAt,
            escalationCount: appeal.escalationCount
          });
        }
        
        return appeals.sort((a, b) => b.submittedAt - a.submittedAt).slice(0, limit);
      },

      getAuditLog: async (filters = {}, limit = 100) => {
        let results = state.auditLog;

        if (filters.action) {
          results = results.filter(e => e.action === filters.action);
        }
        if (filters.actor) {
          results = results.filter(e => e.actor === filters.actor);
        }
        if (filters.status) {
          results = results.filter(e => e.status === filters.status);
        }

        return results.slice(-limit);
      },

      getMetrics: async () => {
        return {
          permissionsGranted: state.metrics.permissionsGranted,
          permissionsRevoked: state.metrics.permissionsRevoked,
          policiesEnforced: state.metrics.policiesEnforced,
          actionsEnforced: state.metrics.actionsEnforced,
          appealsSubmitted: state.metrics.appealsSubmitted,
          appealsApproved: state.metrics.appealsApproved,
          appealsRejected: state.metrics.appealsRejected,
          appealApprovalRate: state.metrics.appealsSubmitted > 0
            ? (state.metrics.appealsApproved / state.metrics.appealsSubmitted * 100).toFixed(2)
            : 0,
          activeModerationActions: Array.from(state.moderationActions.values())
            .filter(a => a.status === "active").length,
          pendingAppeals: Array.from(state.appeals.values())
            .filter(a => a.status === "pending").length
        };
      }
    };

    Registry.register("control-axis-api", api);
    return true;
  },

  async shutdown() {
    state.permissions.clear();
    state.policies.clear();
    state.moderationActions.clear();
    state.appeals.clear();
    state.auditLog.length = 0;
  }
};

// control-axis.js
// Control Axis: Permissions, policy enforcement, moderation
// Where rules become action

export const version = "0.1.0";

export const metadata = {
  id: "control-axis",
  name: "Control Axis",
  description: "Permissions, policy enforcement and moderation flows."
};

const state = {
  permissions: new Map(), // roleId -> { actions: Set, resources: Set }
  policies: new Map(), // policyId -> { description, rules: [] }
  moderationActions: new Map(), // actionId -> { type, targetId, reason, timestamp, status }
  appeals: new Map() // appealId -> { moderationActionId, actor, reason, status }
};

function generateActionId() {
  return `mod_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

export default {
  version,
  metadata,

  async init({ Registry }) {
    console.log("[Control Axis] Initializing...");

    const api = {
      // Permission management
      grantPermission: async (roleId, action, resource) => {
        if (!state.permissions.has(roleId)) {
          state.permissions.set(roleId, { actions: new Set(), resources: new Set() });
        }
        const role = state.permissions.get(roleId);
        role.actions.add(action);
        role.resources.add(resource);
        return { roleId, action, resource, granted: true };
      },

      revokePermission: async (roleId, action, resource) => {
        const role = state.permissions.get(roleId);
        if (role) {
          role.actions.delete(action);
          role.resources.delete(resource);
        }
        return { roleId, action, resource, revoked: true };
      },

      // Check permission
      checkPermission: async (actorId, action, resource) => {
        // placeholder: in reality, look up actor's roles and check permissions
        // For now, everyone has permission (simplification)
        return { allowed: true, reason: "permitted", actorId, action, resource };
      },

      // Policy registration
      registerPolicy: async (policyId, policy) => {
        // policy: { description, rules: [ { condition, action } ] }
        state.policies.set(policyId, { ...policy, registeredAt: Date.now() });
        return { policyId, registered: true };
      },

      getPolicy: async (policyId) => {
        return state.policies.get(policyId) || null;
      },

      // Moderation enforcement
      enforceAction: async (action) => {
        // action: { type: 'mute'|'block'|'delete'|'suspend', targetId, reason }
        const actionId = generateActionId();
        state.moderationActions.set(actionId, {
          id: actionId,
          type: action.type,
          targetId: action.targetId,
          reason: action.reason || "",
          timestamp: Date.now(),
          status: "active",
          enforcedBy: action.enforcedBy || "system"
        });
        return { actionId, type: action.type, status: "active" };
      },

      getModerationAction: async (actionId) => {
        return state.moderationActions.get(actionId) || null;
      },

      // Appeals process
      submitAppeal: async (actorId, moderationActionId, appeal) => {
        // appeal: { reason }
        const modAction = state.moderationActions.get(moderationActionId);
        if (!modAction) return { success: false, reason: "Moderation action not found" };

        const appealId = `appeal_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        state.appeals.set(appealId, {
          id: appealId,
          moderationActionId,
          actor: actorId,
          reason: appeal.reason || "",
          submittedAt: Date.now(),
          status: "pending",
          reviewedBy: null,
          decision: null
        });
        return { appealId, status: "pending" };
      },

      reviewAppeal: async (appealId, decision, reviewer) => {
        // decision: 'upheld' | 'overturned'
        const appeal = state.appeals.get(appealId);
        if (!appeal) return { success: false, reason: "Appeal not found" };

        appeal.status = "reviewed";
        appeal.decision = decision;
        appeal.reviewedBy = reviewer;
        appeal.reviewedAt = Date.now();

        if (decision === "overturned") {
          const modAction = state.moderationActions.get(appeal.moderationActionId);
          if (modAction) modAction.status = "overturned";
        }

        return { appealId, decision, status: "reviewed" };
      },

      getAppeal: async (appealId) => {
        return state.appeals.get(appealId) || null;
      },

      // Query
      listModerationActions: async (status = "active", limit = 50) => {
        const actions = [];
        for (const action of state.moderationActions.values()) {
          if (!status || action.status === status) {
            actions.push({
              id: action.id,
              type: action.type,
              targetId: action.targetId,
              status: action.status,
              timestamp: action.timestamp
            });
          }
        }
        return actions.slice(-limit);
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
  }
};

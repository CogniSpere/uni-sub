// incentive-axis.js
// Incentive Axis: Gamification and economic incentives
// Shapes participation and contribution quality

export const version = "0.1.0";

export const metadata = {
  id: "incentive-axis",
  name: "Incentive Axis",
  description: "Gamification and economic incentives: badges, rewards, and tokens."
};

const state = {
  rewards: new Map() // actorId -> { points: 0, badges: Set, tokensEarned: 0 }
};

export default {
  version,
  metadata,

  async init({ Registry }) {
    console.log("[Incentive Axis] Initializing...");

    const api = {
      // Delegate to gamification module if present
      awardBadge: async (actorId, badgeId) => {
        const gamApi = Registry.get("gamification-api");
        if (gamApi?.awardBadge) {
          return await gamApi.awardBadge(actorId, badgeId);
        }
        return false;
      },

      addPoints: async (actorId, points, meta = {}) => {
        const gamApi = Registry.get("gamification-api");
        if (gamApi?.addPoints) {
          return await gamApi.addPoints(actorId, points, meta);
        }
        return null;
      },

      // Reward distribution
      grantReward: async (actorId, reward) => {
        // reward: { type: 'points'|'badge'|'token', amount, reason }
        if (!state.rewards.has(actorId)) {
          state.rewards.set(actorId, { points: 0, badges: new Set(), tokensEarned: 0 });
        }

        const record = state.rewards.get(actorId);
        let result = { actorId, reward };

        if (reward.type === "points") {
          record.points += reward.amount;
          result.newPoints = record.points;
        } else if (reward.type === "badge") {
          record.badges.add(reward.amount);
          result.badgeAwarded = reward.amount;
        } else if (reward.type === "token") {
          record.tokensEarned += reward.amount;
          result.newTokens = record.tokensEarned;
        }

        return result;
      },

      // Economic operations
      burnTokens: async (actorId, amount) => {
        if (!state.rewards.has(actorId)) return { success: false, reason: "Actor not found" };
        const record = state.rewards.get(actorId);
        if (record.tokensEarned < amount) return { success: false, reason: "Insufficient tokens" };
        record.tokensEarned -= amount;
        return { success: true, remaining: record.tokensEarned };
      },

      transferTokens: async (fromActorId, toActorId, amount) => {
        const from = state.rewards.get(fromActorId);
        if (!from || from.tokensEarned < amount) {
          return { success: false, reason: "Insufficient balance" };
        }
        from.tokensEarned -= amount;
        if (!state.rewards.has(toActorId)) {
          state.rewards.set(toActorId, { points: 0, badges: new Set(), tokensEarned: 0 });
        }
        const to = state.rewards.get(toActorId);
        to.tokensEarned += amount;
        return { success: true, from: fromActorId, to: toActorId, amount };
      },

      // Query incentive status
      getIncentiveRecord: async (actorId) => {
        const record = state.rewards.get(actorId);
        if (!record) return null;
        return {
          actorId,
          points: record.points,
          badges: Array.from(record.badges),
          tokensEarned: record.tokensEarned
        };
      },

      // Leaderboard by incentives
      leaderboard: async (metric = "tokensEarned", limit = 20) => {
        const entries = Array.from(state.rewards.entries())
          .map(([id, record]) => ({
            actorId: id,
            [metric]: record[metric] || 0
          }))
          .sort((a, b) => (b[metric] || 0) - (a[metric] || 0))
          .slice(0, limit);
        return entries;
      }
    };

    Registry.register("incentive-axis-api", api);
    return true;
  },

  async shutdown() {
    state.rewards.clear();
  }
};

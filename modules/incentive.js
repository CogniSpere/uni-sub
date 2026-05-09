// incentive-axis-full.js
// Production-Grade Incentive Axis: Reward economy, token distribution, reward tiers
// Gamification hooks with economic incentives and tier-based progression

export const version = "1.0.0";

export const metadata = {
  id: "incentive-axis",
  name: "Incentive Axis",
  description: "Enterprise-grade reward economy, tokens, badges, and progression tiers.",
  trust_level: "core"
};

const DEFAULT_SCHEMA = {
  rewards: {
    tokenPoolTotal: 1000000,
    tokenPoolAvailable: 1000000,
    distributionRate: 0.001, // tokens per action
    burnDiscount: 0 // deflation mechanism
  },
  tiers: {
    bronze: { minPoints: 0, maxPoints: 999, multiplier: 1.0 },
    silver: { minPoints: 1000, maxPoints: 9999, multiplier: 1.25 },
    gold: { minPoints: 10000, maxPoints: 99999, multiplier: 1.5 },
    platinum: { minPoints: 100000, maxPoints: Infinity, multiplier: 2.0 }
  },
  badges: {
    rarityLevels: ["common", "rare", "epic", "legendary"],
    maxBadgesPerActor: 100
  }
};

const state = {
  rewards: new Map(), // actorId -> { points, badges, tokens, transactions: [] }
  badges: new Map(), // badgeId -> { id, name, rarity, description, earnedCount }
  rewardHistory: [], // audit trail of rewards
  badgeAchievements: new Map(), // actorId -> [ { badgeId, earnedAt } ]
  metrics: {
    rewardsDistributed: 0,
    tokensEarned: 0,
    tokensSpent: 0,
    tokensBurned: 0,
    badgesAwarded: 0,
    actorsRewarded: 0
  },
  schema: {}
};

function _ensureRewardRecord(actorId) {
  if (!state.rewards.has(actorId)) {
    state.rewards.set(actorId, {
      id: actorId,
      points: 0,
      tier: "bronze",
      badges: new Set(),
      tokens: { earned: 0, spent: 0, balance: 0 },
      transactions: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  }
  return state.rewards.get(actorId);
}

function _computeActorTier(points) {
  for (const [tierName, tierConfig] of Object.entries(state.schema.tiers)) {
    if (points >= tierConfig.minPoints && points <= tierConfig.maxPoints) {
      return tierName;
    }
  }
  return "bronze";
}

function _auditLog(action, actorId, amount, details = {}) {
  state.rewardHistory.push({
    id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    action,
    actorId,
    amount,
    timestamp: Date.now(),
    details
  });

  if (state.rewardHistory.length > 10000) {
    state.rewardHistory.shift();
  }
}

function _recordTransaction(actorId, type, amount, reason = "") {
  const record = _ensureRewardRecord(actorId);
  record.transactions.push({
    type, // earn, spend, burn, transfer
    amount,
    reason,
    timestamp: Date.now(),
    balance: record.tokens.balance + (type === "earn" ? amount : -amount)
  });

  if (record.transactions.length > 1000) {
    record.transactions.shift();
  }
}

export default {
  version,
  metadata,

  async init({ Registry }) {
    console.log("[Incentive Axis] Initializing...");

    state.schema = DEFAULT_SCHEMA;

    const api = {
      // ===== Point System =====

      addPoints: async (actorId, points, meta = {}) => {
        const record = _ensureRewardRecord(actorId);
        const previousTier = record.tier;

        record.points += Math.max(0, points);
        record.tier = _computeActorTier(record.points);
        record.updatedAt = Date.now();

        state.metrics.rewardsDistributed++;

        _auditLog("points_added", actorId, points, {
          newTotal: record.points,
          tierChanged: previousTier !== record.tier ? record.tier : null,
          ...meta
        });

        return {
          success: true,
          actorId,
          pointsAdded: points,
          totalPoints: record.points,
          tier: record.tier,
          tierAdvanced: previousTier !== record.tier
        };
      },

      deductPoints: async (actorId, points, reason = "") => {
        const record = _ensureRewardRecord(actorId);
        const previousTier = record.tier;

        if (record.points < points) {
          return { success: false, reason: "Insufficient points" };
        }

        record.points -= points;
        record.tier = _computeActorTier(record.points);
        record.updatedAt = Date.now();

        _auditLog("points_deducted", actorId, points, { reason });

        return {
          success: true,
          actorId,
          pointsDeducted: points,
          totalPoints: record.points,
          tier: record.tier,
          tierDowngraded: previousTier !== record.tier ? record.tier : null
        };
      },

      // ===== Badge System =====

      registerBadge: async (badgeId, badgeObj) => {
        const { name, description = "", rarity = "common" } = badgeObj;

        const validRarities = state.schema.badges.rarityLevels;
        if (!validRarities.includes(rarity)) {
          return { success: false, reason: `Invalid rarity: ${rarity}` };
        }

        state.badges.set(badgeId, {
          id: badgeId,
          name,
          description,
          rarity,
          earnedCount: 0,
          registeredAt: Date.now()
        });

        return { success: true, badgeId, rarity };
      },

      awardBadge: async (actorId, badgeId) => {
        const record = _ensureRewardRecord(actorId);
        const badge = state.badges.get(badgeId);

        if (!badge) return { success: false, reason: "Badge not found" };

        if (record.badges.has(badgeId)) {
          return { success: false, reason: "Badge already awarded to this actor" };
        }

        if (record.badges.size >= state.schema.badges.maxBadgesPerActor) {
          return { success: false, reason: "Max badges per actor exceeded" };
        }

        record.badges.add(badgeId);
        badge.earnedCount++;
        record.updatedAt = Date.now();

        if (!state.badgeAchievements.has(actorId)) {
          state.badgeAchievements.set(actorId, []);
        }
        state.badgeAchievements.get(actorId).push({
          badgeId,
          earnedAt: Date.now(),
          rarity: badge.rarity
        });

        state.metrics.badgesAwarded++;

        _auditLog("badge_awarded", actorId, 0, { badgeId, rarity: badge.rarity });

        return {
          success: true,
          actorId,
          badgeId,
          badgeAwarded: badge.name,
          totalBadges: record.badges.size
        };
      },

      getBadges: async (actorId) => {
        const record = state.rewards.get(actorId);
        if (!record) return [];

        return Array.from(record.badges).map(badgeId => {
          const badge = state.badges.get(badgeId);
          return {
            badgeId,
            name: badge?.name,
            rarity: badge?.rarity,
            earnedAt: state.badgeAchievements.get(actorId)
              ?.find(b => b.badgeId === badgeId)?.earnedAt || Date.now()
          };
        });
      },

      // ===== Token Economy =====

      grantTokens: async (actorId, amount, reason = "") => {
        if (amount <= 0) return { success: false, reason: "Amount must be positive" };

        const record = _ensureRewardRecord(actorId);

        if (state.metrics.tokenPoolAvailable < amount) {
          return { success: false, reason: "Insufficient token pool" };
        }

        record.tokens.earned += amount;
        record.tokens.balance += amount;
        record.updatedAt = Date.now();

        state.metrics.tokenPoolAvailable -= amount;
        state.metrics.tokensEarned += amount;
        state.metrics.actorsRewarded++;

        _recordTransaction(actorId, "earn", amount, reason);
        _auditLog("tokens_granted", actorId, amount, { reason });

        return {
          success: true,
          actorId,
          tokensGranted: amount,
          newBalance: record.tokens.balance,
          reason
        };
      },

      burnTokens: async (actorId, amount, reason = "") => {
        const record = state.rewards.get(actorId);
        if (!record) return { success: false, reason: "Actor not found" };

        if (record.tokens.balance < amount) {
          return { success: false, reason: "Insufficient tokens" };
        }

        const burnedAmount = Math.round(amount * (1 - state.schema.rewards.burnDiscount));
        record.tokens.balance -= amount;
        record.tokens.spent += burnedAmount;
        record.updatedAt = Date.now();

        state.metrics.tokenPoolAvailable += burnedAmount; // Return to pool
        state.metrics.tokensBurned += burnedAmount;

        _recordTransaction(actorId, "burn", amount, reason);
        _auditLog("tokens_burned", actorId, burnedAmount, { reason });

        return {
          success: true,
          actorId,
          tokensBurned: burnedAmount,
          newBalance: record.tokens.balance
        };
      },

      transferTokens: async (fromActorId, toActorId, amount, reason = "") => {
        const from = state.rewards.get(fromActorId);
        if (!from || from.tokens.balance < amount) {
          return { success: false, reason: "Insufficient balance" };
        }

        const to = _ensureRewardRecord(toActorId);

        from.tokens.balance -= amount;
        from.tokens.spent += amount;
        from.updatedAt = Date.now();

        to.tokens.earned += amount;
        to.tokens.balance += amount;
        to.updatedAt = Date.now();

        _recordTransaction(fromActorId, "spend", amount, `transfer to ${toActorId}`);
        _recordTransaction(toActorId, "earn", amount, `transfer from ${fromActorId}`);

        _auditLog("tokens_transferred", fromActorId, amount, {
          to: toActorId,
          reason
        });

        return {
          success: true,
          from: fromActorId,
          to: toActorId,
          amount,
          fromBalance: from.tokens.balance,
          toBalance: to.tokens.balance
        };
      },

      // ===== Queries =====

      getIncentiveRecord: async (actorId) => {
        const record = state.rewards.get(actorId);
        if (!record) return null;

        return {
          actorId,
          points: record.points,
          tier: record.tier,
          badges: Array.from(record.badges),
          badgeCount: record.badges.size,
          tokens: {
            earned: record.tokens.earned,
            spent: record.tokens.spent,
            balance: record.tokens.balance
          },
          createdAt: record.createdAt,
          updatedAt: record.updatedAt
        };
      },

      getTokenTransactionHistory: async (actorId, limit = 50) => {
        const record = state.rewards.get(actorId);
        if (!record) return [];

        return record.transactions.slice(-limit);
      },

      leaderboard: async (options = {}) => {
        const { metric = "points", limit = 20, rarity = null } = options;

        let entries = Array.from(state.rewards.entries()).map(([id, record]) => ({
          actorId: id,
          points: record.points,
          tier: record.tier,
          tokens: record.tokens.balance,
          badgeCount: record.badges.size,
          [metric]: record[metric] || (metric === "tokens" ? record.tokens.balance : 0)
        }));

        // Filter by badge rarity if specified
        if (rarity) {
          entries = entries.filter(e => {
            const actor = state.rewards.get(e.actorId);
            return Array.from(actor.badges).some(badgeId => {
              const badge = state.badges.get(badgeId);
              return badge?.rarity === rarity;
            });
          });
        }

        entries.sort((a, b) => (b[metric] || 0) - (a[metric] || 0));
        return entries.slice(0, limit);
      },

      getMetrics: async () => {
        const totalPoints = Array.from(state.rewards.values())
          .reduce((sum, r) => sum + r.points, 0);
        
        const totalTokensInCirculation = Array.from(state.rewards.values())
          .reduce((sum, r) => sum + r.tokens.balance, 0);

        return {
          rewardsDistributed: state.metrics.rewardsDistributed,
          tokensEarned: state.metrics.tokensEarned,
          tokensSpent: state.metrics.tokensSpent,
          tokensBurned: state.metrics.tokensBurned,
          badgesAwarded: state.metrics.badgesAwarded,
          actorsRewarded: state.metrics.actorsRewarded,
          totalActorsWithRewards: state.rewards.size,
          totalPoints: totalPoints,
          totalTokensInCirculation,
          tokenPoolAvailable: state.metrics.tokenPoolAvailable,
          tokenPoolUtilization: (
            ((state.schema.rewards.tokenPoolTotal - state.metrics.tokenPoolAvailable) / 
            state.schema.rewards.tokenPoolTotal) * 100
          ).toFixed(2),
          registeredBadges: state.badges.size
        };
      }
    };

    Registry.register("incentive-axis-api", api);
    return true;
  },

  async shutdown() {
    state.rewards.clear();
    state.badges.clear();
    state.rewardHistory.length = 0;
    state.badgeAchievements.clear();
  }
};

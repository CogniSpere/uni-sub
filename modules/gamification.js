// gamification-axis-full.js
// Production-Grade Gamification Axis: Points, streaks, badges, milestones, progression
// Engagement economy with multi-dimensional reward systems and progression tracking

export const version = "1.0.0";

export const metadata = {
  id: "gamification-axis",
  name: "Gamification Axis",
  description: "Enterprise-grade gamification with points, streaks, badges, milestones, and reward pools.",
  trust_level: "core"
};

const DEFAULT_SCHEMA = {
  actions: {
    defaultPointValue: 1,
    enableStreaks: true,
    enableMultipliers: true,
    maxActionsPerDay: 1000
  },
  streaks: {
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    minConsecutive: 2,
    maxStreakLength: 365,
    streakBonus: { enabled: true, factor: 0.1 } // 10% bonus per streak
  },
  badges: {
    rarityLevels: ["common", "rare", "epic", "legendary"],
    maxBadgesPerUser: 100,
    enableRarityBonus: true,
    rarityBonusMultiplier: { common: 1.0, rare: 1.5, epic: 2.0, legendary: 3.0 }
  },
  milestones: {
    enableAutomation: true,
    maxMilestonesPerUser: 50,
    cascadeRewards: true
  },
  rewards: {
    poolSize: 1000000,
    poolAvailable: 1000000,
    maxClaimsPerUser: null,
    enableThrottling: true,
    throttleWindowMs: 3600000 // 1 hour
  },
  progression: {
    enableTiers: true,
    enableLevelSystem: false,
    tierDecay: false,
    decayRatePerDayMs: 0
  }
};

const state = {
  users: new Map(), // userId -> { id, points, badges, streaks, actionHistory, rewards, tiers, metadata, ... }
  actions: new Map(), // actionType -> { name, points, rarity, multipliers, badges, milestones, createdAt }
  badges: new Map(), // badgeId -> { id, name, rarity, description, earnedCount, createdAt }
  milestones: new Map(), // milestoneId -> { id, name, target, metric, reward, badgeId, createdAt }
  rewards: new Map(), // rewardId -> { id, name, cost, type, data, availableCount, claimedCount, createdAt }
  actionHistory: [], // audit trail of all actions
  streakHistory: new Map(), // userId -> [ { actionType, count, lastAt, earnedAt } ]
  tierProgression: new Map(), // userId -> { tier, points, joinedAt, promotedAt }
  rewardClaims: new Map(), // claimId -> { userId, rewardId, claimedAt, claimedBy }
  conflicts: [], // detected conflicts
  metrics: {
    usersCreated: 0,
    actionsTracked: 0,
    pointsAwarded: 0,
    badgesAwarded: 0,
    milestonesReached: 0,
    rewardsClaimed: 0,
    rewardsPoolRemaining: DEFAULT_SCHEMA.rewards.poolAvailable,
    streaksActive: 0,
    conflictsDetected: 0
  },
  schema: {}
};

function generateUserId() {
  return `user_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

function generateActionId() {
  return `action_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

function generateBadgeId() {
  return `badge_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

function generateMilestoneId() {
  return `milestone_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

function generateRewardId() {
  return `reward_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

function generateClaimId() {
  return `claim_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

function _ensureUser(userId) {
  if (!state.users.has(userId)) {
    state.users.set(userId, {
      id: userId,
      points: 0,
      badges: new Set(),
      streaks: new Map(), // actionType -> { count, lastAt, startedAt, bonus }
      actionHistory: [],
      actionTotals: new Map(), // actionType -> count
      rewards: [],
      claimedRewards: new Set(),
      tier: "bronze",
      level: 1,
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    state.metrics.usersCreated++;
  }
  return state.users.get(userId);
}

function _computeTier(points) {
  if (points >= 100000) return "platinum";
  if (points >= 10000) return "gold";
  if (points >= 1000) return "silver";
  return "bronze";
}

function _checkStreakContinuation(userId, actionType, now) {
  const user = state.users.get(userId);
  if (!user) return { count: 0, continued: false };

  const streak = user.streaks.get(actionType);
  if (!streak) {
    return { count: 0, continued: false };
  }

  const timeSinceLastAction = now - streak.lastAt;
  if (timeSinceLastAction <= state.schema.streaks.windowMs) {
    return { count: streak.count + 1, continued: true };
  }

  return { count: 1, continued: false };
}

function _computeStreakBonus(streakCount) {
  if (!state.schema.streaks.streakBonus.enabled) return 0;
  if (streakCount < state.schema.streaks.minConsecutive) return 0;
  
  const factor = state.schema.streaks.streakBonus.factor;
  return (streakCount - 1) * factor;
}

function _computeRarityBonus(rarity) {
  if (!state.schema.badges.enableRarityBonus) return 1.0;
  return state.schema.badges.rarityBonusMultiplier[rarity] || 1.0;
}

function _auditLog(action, actor, actionType, points, details = {}) {
  state.actionHistory.push({
    id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    action,
    actor,
    actionType,
    points,
    timestamp: Date.now(),
    details
  });

  if (state.actionHistory.length > 10000) {
    state.actionHistory.shift();
  }
}

function _checkMilestones(userId) {
  const user = state.users.get(userId);
  if (!user) return [];

  const awarded = [];

  for (const [milestoneId, milestone] of state.milestones.entries()) {
    // Check if already achieved
    if (user.actionHistory.some(h => h.details.milestoneId === milestoneId)) {
      continue;
    }

    // Check metric
    let metricValue = 0;
    if (milestone.metric === "points") {
      metricValue = user.points;
    } else if (milestone.metric === "badges") {
      metricValue = user.badges.size;
    } else if (milestone.metric === "actions") {
      const actionType = milestone.actionType;
      metricValue = user.actionTotals.get(actionType) || 0;
    }

    if (metricValue >= milestone.target) {
      // Award milestone
      if (milestone.badgeId) {
        user.badges.add(milestone.badgeId);
      }

      if (milestone.reward) {
        user.points += milestone.reward;
        state.metrics.pointsAwarded += milestone.reward;
      }

      user.actionHistory.push({
        type: "milestone_reached",
        milestoneId,
        timestamp: Date.now(),
        value: metricValue
      });

      state.metrics.milestonesReached++;
      awarded.push(milestoneId);

      _auditLog("milestone_reached", userId, milestone.id, milestone.reward || 0, {
        milestoneId,
        metric: milestone.metric,
        target: milestone.target,
        metricValue
      });
    }
  }

  return awarded;
}

export default {
  version,
  metadata,

  async init({ Registry }) {
    console.log("[Gamification Axis] Initializing...");

    state.schema = DEFAULT_SCHEMA;

    const api = {
      // ===== Action Management =====

      registerAction: async (actionType, actionObj) => {
        const { name, points = state.schema.actions.defaultPointValue, rarity = "common", metadata = {} } = actionObj;

        if (!name || typeof name !== "string") {
          return { success: false, reason: "Action must have a name" };
        }

        if (points < 0) {
          return { success: false, reason: "Points must be non-negative" };
        }

        state.actions.set(actionType, {
          actionType,
          name,
          points,
          rarity,
          metadata,
          createdAt: Date.now()
        });

        return {
          success: true,
          actionType,
          name,
          points,
          rarity
        };
      },

      getAction: async (actionType) => {
        const action = state.actions.get(actionType);
        if (!action) return null;

        return {
          actionType: action.actionType,
          name: action.name,
          points: action.points,
          rarity: action.rarity,
          metadata: action.metadata
        };
      },

      // ===== Action Tracking =====

      trackAction: async (userId, actionType, options = {}) => {
        const action = state.actions.get(actionType);
        if (!action) {
          return { success: false, reason: `Action type ${actionType} not found` };
        }

        const user = _ensureUser(userId);
        const now = Date.now();

        // Check daily limit
        const today = Math.floor(now / 86400000);
        const todaysActions = user.actionHistory.filter(a => Math.floor(a.timestamp / 86400000) === today).length;
        if (todaysActions >= state.schema.actions.maxActionsPerDay) {
          return { success: false, reason: "Daily action limit exceeded" };
        }

        // Check and update streak
        let streakBonus = 0;
        if (state.schema.actions.enableStreaks) {
          const { count, continued } = _checkStreakContinuation(userId, actionType, now);

          if (!user.streaks.has(actionType)) {
            user.streaks.set(actionType, { count: 1, lastAt: now, startedAt: now, bonus: 0 });
          } else {
            const streak = user.streaks.get(actionType);
            streak.count = count;
            streak.lastAt = now;
            if (!continued) {
              streak.startedAt = now;
            }

            if (count >= state.schema.streaks.minConsecutive) {
              streakBonus = _computeStreakBonus(count);
              streak.bonus = streakBonus;
              state.metrics.streaksActive++;
            }
          }
        }

        // Calculate base points
        let pointsAwarded = action.points;

        // Apply streak multiplier
        if (state.schema.actions.enableMultipliers && streakBonus > 0) {
          pointsAwarded = Math.round(pointsAwarded * (1 + streakBonus));
        }

        // Apply rarity bonus
        const rarityBonus = _computeRarityBonus(action.rarity);
        if (rarityBonus > 1.0) {
          pointsAwarded = Math.round(pointsAwarded * rarityBonus);
        }

        user.points += pointsAwarded;
        state.metrics.pointsAwarded += pointsAwarded;
        state.metrics.actionsTracked++;

        // Update action totals
        const actionTotal = (user.actionTotals.get(actionType) || 0) + 1;
        user.actionTotals.set(actionType, actionTotal);

        // Record action
        user.actionHistory.push({
          actionType,
          timestamp: now,
          pointsAwarded,
          streakCount: user.streaks.get(actionType)?.count || 0,
          streakBonus,
          rarityMultiplier: rarityBonus
        });

        if (user.actionHistory.length > 1000) {
          user.actionHistory.shift();
        }

        user.updatedAt = now;

        // Update tier
        const previousTier = user.tier;
        user.tier = _computeTier(user.points);

        // Check milestones
        const milestonesAwarded = _checkMilestones(userId);

        _auditLog("action_tracked", userId, actionType, pointsAwarded, {
          streakCount: user.streaks.get(actionType)?.count || 0,
          streakBonus,
          rarityMultiplier: rarityBonus,
          milestonesAwarded
        });

        return {
          success: true,
          userId,
          actionType,
          pointsAwarded,
          totalPoints: user.points,
          streak: user.streaks.get(actionType) || { count: 0, bonus: 0 },
          tier: user.tier,
          tierAdvanced: previousTier !== user.tier,
          milestonesAwarded
        };
      },

      // ===== Badge System =====

      registerBadge: async (badgeObj) => {
        const { name, description = "", rarity = "common" } = badgeObj;
        const badgeId = generateBadgeId();

        if (!state.schema.badges.rarityLevels.includes(rarity)) {
          return { success: false, reason: `Invalid rarity: ${rarity}` };
        }

        state.badges.set(badgeId, {
          id: badgeId,
          name,
          description,
          rarity,
          earnedCount: 0,
          createdAt: Date.now()
        });

        return { success: true, badgeId, name, rarity };
      },

      awardBadge: async (userId, badgeId) => {
        const user = _ensureUser(userId);
        const badge = state.badges.get(badgeId);

        if (!badge) return { success: false, reason: "Badge not found" };
        if (user.badges.has(badgeId)) {
          return { success: false, reason: "Badge already awarded to this user" };
        }
        if (user.badges.size >= state.schema.badges.maxBadgesPerUser) {
          return { success: false, reason: "Max badges per user exceeded" };
        }

        user.badges.add(badgeId);
        badge.earnedCount++;
        user.updatedAt = Date.now();

        state.metrics.badgesAwarded++;

        _auditLog("badge_awarded", userId, badge.id, 0, { badgeId, rarity: badge.rarity });

        return {
          success: true,
          userId,
          badgeId,
          badgeName: badge.name,
          totalBadges: user.badges.size
        };
      },

      getBadges: async (userId) => {
        const user = state.users.get(userId);
        if (!user) return [];

        return Array.from(user.badges).map(badgeId => {
          const badge = state.badges.get(badgeId);
          return {
            badgeId,
            name: badge?.name,
            rarity: badge?.rarity,
            description: badge?.description
          };
        });
      },

      // ===== Milestone System =====

      registerMilestone: async (milestoneObj) => {
        const { name, target, metric = "points", reward = 0, badgeId = null, actionType = null } = milestoneObj;
        const milestoneId = generateMilestoneId();

        if (target <= 0) {
          return { success: false, reason: "Target must be positive" };
        }

        state.milestones.set(milestoneId, {
          id: milestoneId,
          name,
          target,
          metric,
          reward,
          badgeId,
          actionType,
          createdAt: Date.now()
        });

        return { success: true, milestoneId, name, target, metric };
      },

      getMilestone: async (milestoneId) => {
        const milestone = state.milestones.get(milestoneId);
        if (!milestone) return null;

        return {
          id: milestone.id,
          name: milestone.name,
          target: milestone.target,
          metric: milestone.metric,
          reward: milestone.reward,
          badgeId: milestone.badgeId
        };
      },

      // ===== Reward System =====

      registerReward: async (rewardObj) => {
        const { name, cost, type = "token", availableCount = null, data = {} } = rewardObj;
        const rewardId = generateRewardId();

        if (cost < 0) {
          return { success: false, reason: "Cost must be non-negative" };
        }

        state.rewards.set(rewardId, {
          id: rewardId,
          name,
          cost,
          type,
          data,
          availableCount,
          claimedCount: 0,
          createdAt: Date.now()
        });

        return { success: true, rewardId, name, cost, type };
      },

      claimReward: async (userId, rewardId) => {
        const user = _ensureUser(userId);
        const reward = state.rewards.get(rewardId);

        if (!reward) return { success: false, reason: "Reward not found" };
        if (user.points < reward.cost) {
          return { success: false, reason: "Insufficient points" };
        }
        if (user.claimedRewards.has(rewardId)) {
          if (!state.schema.rewards.maxClaimsPerUser) {
            return { success: false, reason: "Reward already claimed" };
          }
        }

        // Check availability
        if (reward.availableCount !== null && reward.claimedCount >= reward.availableCount) {
          return { success: false, reason: "Reward no longer available" };
        }

        // Deduct points
        user.points -= reward.cost;
        user.claimedRewards.add(rewardId);
        reward.claimedCount++;

        // Update pool
        state.metrics.rewardsPoolRemaining = Math.max(0, state.metrics.rewardsPoolRemaining - reward.cost);
        state.metrics.rewardsClaimed++;

        const claimId = generateClaimId();
        state.rewardClaims.set(claimId, {
          id: claimId,
          userId,
          rewardId,
          claimedAt: Date.now()
        });

        _auditLog("reward_claimed", userId, rewardId, -reward.cost, { claimId });

        return {
          success: true,
          claimId,
          userId,
          rewardId,
          rewardName: reward.name,
          pointsSpent: reward.cost,
          remainingPoints: user.points
        };
      },

      // ===== Profile & Leaderboards =====

      getProfile: async (userId) => {
        const user = state.users.get(userId);
        if (!user) return null;

        return {
          id: user.id,
          points: user.points,
          tier: user.tier,
          level: user.level,
          badges: Array.from(user.badges),
          badgeCount: user.badges.size,
          streaks: Object.fromEntries(user.streaks),
          totalActions: Array.from(user.actionTotals.values()).reduce((a, b) => a + b, 0),
          actionBreakdown: Object.fromEntries(user.actionTotals),
          claimedRewards: Array.from(user.claimedRewards),
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        };
      },

      getLeaderboard: async (options = {}) => {
        const { limit = 50, metric = "points", minTier = null } = options;

        let users = Array.from(state.users.values());

        if (minTier) {
          users = users.filter(u => {
            const tierOrder = { bronze: 0, silver: 1, gold: 2, platinum: 3 };
            return tierOrder[u.tier] >= tierOrder[minTier];
          });
        }

        users.sort((a, b) => {
          const aVal = metric === "badges" ? a.badges.size : a[metric] || 0;
          const bVal = metric === "badges" ? b.badges.size : b[metric] || 0;
          return bVal - aVal;
        });

        return users.slice(0, limit).map((u, idx) => ({
          rank: idx + 1,
          userId: u.id,
          points: u.points,
          tier: u.tier,
          badges: u.badges.size,
          metric: metric === "badges" ? u.badges.size : u[metric]
        }));
      },

      // ===== Queries =====

      getActionHistory: async (userId, limit = 50) => {
        const user = state.users.get(userId);
        if (!user) return [];

        return user.actionHistory.slice(-limit);
      },

      getMetrics: async () => {
        const activeBadges = Array.from(state.badges.values()).reduce((sum, b) => sum + b.earnedCount, 0);
        const totalPointsInSystem = Array.from(state.users.values()).reduce((sum, u) => sum + u.points, 0);

        return {
          usersCreated: state.metrics.usersCreated,
          actionsTracked: state.metrics.actionsTracked,
          pointsAwarded: state.metrics.pointsAwarded,
          badgesAwarded: state.metrics.badgesAwarded,
          milestonesReached: state.metrics.milestonesReached,
          rewardsClaimed: state.metrics.rewardsClaimed,
          totalActiveUsers: state.users.size,
          totalPointsInCirculation: totalPointsInSystem,
          rewardsPoolRemaining: state.metrics.rewardsPoolRemaining,
          streaksActive: state.metrics.streaksActive,
          registeredActions: state.actions.size,
          registeredBadges: state.badges.size,
          registeredMilestones: state.milestones.size,
          registeredRewards: state.rewards.size,
          totalBadgesAwarded: activeBadges
        };
      }
    };

    Registry.register("gamification-axis-api", api);
    return true;
  },

  async shutdown() {
    state.users.clear();
    state.actions.clear();
    state.badges.clear();
    state.milestones.clear();
    state.rewards.clear();
    state.actionHistory.length = 0;
    state.streakHistory.clear();
    state.tierProgression.clear();
    state.rewardClaims.clear();
    state.conflicts.length = 0;
  }
};

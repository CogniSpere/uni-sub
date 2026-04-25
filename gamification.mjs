// Universal Gamification Engine (ES module)
// File: gamification.mjs
// Minimal, dependency-free, universal engine prototype.

// Usage:
// import UGE from './gamification.mjs';
// await UGE.init(schemaData, {store: optionalPersistenceProvider});
// UGE.trackAction(userId, actionType, metadata);
// const profile = UGE.getProfile(userId);
// const leaderboard = UGE.getLeaderboard();
// UGE.claimReward(userId, rewardId);

const DEFAULT_STREAK_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

function now() {
  return Date.now();
}

// In-memory store implementation (fallback)
function createMemoryStore() {
  const users = new Map();
  return {
    async getUser(id) { return users.get(id) || null; },
    async setUser(id, data) { users.set(id, data); return data; },
    async listUsers() { return Array.from(users.values()); },
  };
}

// The engine state
const Engine = {
  _initialized: false,
  _schema: null,
  _store: createMemoryStore(),
  _options: {},
};

// Ensure user object shape
function _ensureUser(u) {
  return {
    id: u.id,
    points: u.points || 0,
    badges: new Set(u.badges || []),
    milestones: Object.assign({}, u.milestones || {}),
    rewardsClaimed: new Set(u.rewardsClaimed || []),
    // streaks: { actionType: {count, lastAt} }
    streaks: Object.assign({}, u.streaks || {}),
    createdAt: u.createdAt || now(),
    updatedAt: u.updatedAt || now(),
  };
}

async function init(schemaData = {}, options = {}) {
  // schemaData is expected to be an object which can include:
  // - badges: array
  // - milestones: array
  // - rewardPools: array
  // - actions: { actionType: { points, badgeOnFirst, badgeOnThreshold } }
  Engine._schema = schemaData;
  Engine._options = options || {};
  Engine._store = (options.store || createMemoryStore());
  Engine._streakWindowMs = options.streakWindowMs || DEFAULT_STREAK_WINDOW_MS;
  Engine._initialized = true;
  return true;
}

// internal helper to load or create a user profile in store
async function _loadUser(userId) {
  let u = await Engine._store.getUser(userId);
  if (!u) {
    u = _ensureUser({ id: userId });
    await Engine._store.setUser(userId, u);
  } else {
    u = _ensureUser(u);
  }
  return u;
}

// Persist user
async function _saveUser(u) {
  u.updatedAt = now();
  // Convert Sets to arrays for storage compatibility
  const out = Object.assign({}, u, {
    badges: Array.from(u.badges || new Set()),
    rewardsClaimed: Array.from(u.rewardsClaimed || new Set()),
  });
  await Engine._store.setUser(u.id, out);
}

// Award a badge (id or object) if not already owned
function _awardBadge(user, badgeId) {
  if (!badgeId) return false;
  if (user.badges.has(badgeId)) return false;
  user.badges.add(badgeId);
  return true;
}

// Check milestones from schema and update user's milestones
function _checkMilestones(user) {
  const milestones = Engine._schema && Engine._schema.milestones ? Engine._schema.milestones : [];
  let awarded = [];
  for (const m of milestones) {
    const id = m.id;
    const target = m.target || 0;
    // Use points or a specified metric
    const metric = (m.metric === 'points' || !m.metric) ? user.points : (user[m.metric] || 0);
    if (metric >= target && !user.milestones[id]) {
      user.milestones[id] = { achievedAt: now(), milestone: m };
      if (m.badgeId) _awardBadge(user, m.badgeId);
      awarded.push(id);
    }
  }
  return awarded;
}

// Update leaderboard is derived at query time
async function trackAction(userId, actionType, metadata = {}) {
  if (!Engine._initialized) throw new Error('Engine not initialized. Call init(schemaData) first.');
  const actionCfg = (Engine._schema && Engine._schema.actions && Engine._schema.actions[actionType]) || {};
  const points = actionCfg.points || 0;
  const badgeOnFirst = actionCfg.badgeOnFirst;
  const badgeOnThreshold = actionCfg.badgeOnThreshold; // {threshold, badgeId}

  const user = await _loadUser(userId);

  // Streak handling
  const nowTs = now();
  const s = user.streaks[actionType] || { count: 0, lastAt: 0 };
  if (s.lastAt && (nowTs - s.lastAt) <= Engine._streakWindowMs) {
    s.count += 1;
  } else {
    s.count = 1;
  }
  s.lastAt = nowTs;
  user.streaks[actionType] = s;

  // Points calculation can incorporate streak bonuses
  let pointsToAdd = points;
  if (actionCfg.streakBonus) {
    // simple linear bonus: multiplier = 1 + (streakCount-1) * factor
    const f = actionCfg.streakBonus.factor || 0;
    const multiplier = 1 + ((s.count - 1) * f);
    pointsToAdd = Math.round(pointsToAdd * multiplier);
  }

  user.points += pointsToAdd;

  // First-time badge
  if (badgeOnFirst) {
    // if this is user's first time doing this action (count === 1) award badge
    if (s.count === 1) _awardBadge(user, badgeOnFirst);
  }

  // Threshold badge
  if (badgeOnThreshold && typeof badgeOnThreshold.threshold === 'number') {
    if (s.count >= badgeOnThreshold.threshold) {
      _awardBadge(user, badgeOnThreshold.badgeId);
    }
  }

  // If actionCfg.badgeOnPoints: award badge when user's cumulative points for this action exceed threshold
  if (actionCfg.badgeOnPoints) {
    const totalForAction = (user.actionTotals && user.actionTotals[actionType]) || 0;
    const newTotal = totalForAction + 1; // assume each trackAction increments the action count by 1
    user.actionTotals = user.actionTotals || {};
    user.actionTotals[actionType] = newTotal;
    if (newTotal >= actionCfg.badgeOnPoints.threshold) {
      _awardBadge(user, actionCfg.badgeOnPoints.badgeId);
    }
  }

  // Check milestone achievement
  const milestonesAwarded = _checkMilestones(user);

  await _saveUser(user);

  return {
    pointsAdded: pointsToAdd,
    totalPoints: user.points,
    streak: Object.assign({}, s),
    badgesAwarded: Array.from(user.badges),
    milestonesAwarded,
  };
}

async function getProfile(userId) {
  const u = await _loadUser(userId);
  // return a copy-friendly object
  return {
    id: u.id,
    points: u.points,
    badges: Array.from(u.badges),
    milestones: u.milestones,
    streaks: u.streaks,
    rewardsClaimed: Array.from(u.rewardsClaimed),
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

async function getLeaderboard({ limit = 50, metric = 'points' } = {}) {
  // metric can be 'points' or any numeric property stored on users
  const users = await Engine._store.listUsers();
  // users might be raw stored objects; normalize
  const normalized = users.map(u => {
    const nu = _ensureUser(u);
    return nu;
  });
  normalized.sort((a, b) => (b[metric] || 0) - (a[metric] || 0));
  return normalized.slice(0, limit).map(u => ({ id: u.id, points: u.points, badges: Array.from(u.badges) }));
}

async function claimReward(userId, rewardId) {
  if (!Engine._schema || !Engine._schema.rewardPools) throw new Error('No rewardPools defined in schema.');
  const reward = Engine._schema.rewardPools.find(r => r.id === rewardId);
  if (!reward) throw new Error('Unknown rewardId');
  const user = await _loadUser(userId);
  if (user.rewardsClaimed.has(rewardId)) throw new Error('Reward already claimed');
  // validate cost
  const cost = reward.cost || 0;
  if (user.points < cost) throw new Error('Insufficient points');
  // process reward (this engine is "dumb"; side-effects should be handled by caller or by reward providers)
  user.points -= cost;
  user.rewardsClaimed.add(rewardId);
  await _saveUser(user);
  return { success: true, remainingPoints: user.points, rewardId };
}

// Lightweight schema validation helper
function validateSchema(s) {
  if (!s) return false;
  // Basic checks
  if (s.actions && typeof s.actions !== 'object') return false;
  if (s.milestones && !Array.isArray(s.milestones)) return false;
  if (s.badges && !Array.isArray(s.badges)) return false;
  return true;
}

export default {
  init: async (schemaData, options) => {
    if (!validateSchema(schemaData)) throw new Error('Invalid schemaData');
    return await init(schemaData, options);
  },
  trackAction,
  getProfile,
  getLeaderboard,
  claimReward,
  // for testing / admin
  _internal: {
    _engineState: Engine,
    _ensureUser,
    _loadUser,
    _saveUser,
  }
};

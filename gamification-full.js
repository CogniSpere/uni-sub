// Universal Gamification Engine (pure ESM, browser + bundlers)
// File: gamification.js
// Minimal, dependency-free, universal engine prototype as a .js ESM file.

const DEFAULT_STREAK_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

function now() { return Date.now(); }

function createMemoryStore() {
  const users = new Map();
  return {
    async getUser(id) { return users.get(id) || null; },
    async setUser(id, data) { users.set(id, data); return data; },
    async listUsers() { return Array.from(users.values()); },
  };
}

const Engine = {
  _initialized: false,
  _schema: null,
  _store: createMemoryStore(),
  _options: {},
};

function _ensureUser(u) {
  return {
    id: u.id,
    points: u.points || 0,
    badges: new Set(u.badges || []),
    milestones: Object.assign({}, u.milestones || {}),
    rewardsClaimed: new Set(u.rewardsClaimed || []),
    streaks: Object.assign({}, u.streaks || {}),
    actionTotals: Object.assign({}, u.actionTotals || {}),   // ← This was missing
    createdAt: u.createdAt || now(),
    updatedAt: u.updatedAt || now(),
  };
}

async function init(schemaData = {}, options = {}) {
  Engine._schema = schemaData;
  Engine._options = options || {};
  Engine._store = (options.store || createMemoryStore());
  Engine._streakWindowMs = options.streakWindowMs || DEFAULT_STREAK_WINDOW_MS;
  Engine._initialized = true;
  return true;
}

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

async function _saveUser(u) {
  u.updatedAt = now();
  const out = Object.assign({}, u, {
    badges: Array.from(u.badges || new Set()),
    rewardsClaimed: Array.from(u.rewardsClaimed || new Set()),
  });
  await Engine._store.setUser(u.id, out);
}

function _awardBadge(user, badgeId) {
  if (!badgeId) return false;
  if (user.badges.has(badgeId)) return false;
  user.badges.add(badgeId);
  return true;
}

function _checkMilestones(user) {
  const milestones = Engine._schema && Engine._schema.milestones ? Engine._schema.milestones : [];
  let awarded = [];
  for (const m of milestones) {
    const id = m.id;
    const target = m.target || 0;
    const metric = (m.metric === 'points' || !m.metric) ? user.points : (user[m.metric] || 0);
    if (metric >= target && !user.milestones[id]) {
      user.milestones[id] = { achievedAt: now(), milestone: m };
      if (m.badgeId) _awardBadge(user, m.badgeId);
      awarded.push(id);
    }
  }
  return awarded;
}

async function trackAction(userId, actionType, metadata = {}) {
  if (!Engine._initialized) throw new Error('Engine not initialized. Call init(schemaData) first.');
  const actionCfg = (Engine._schema && Engine._schema.actions && Engine._schema.actions[actionType]) || {};
  const points = actionCfg.points || 0;
  const badgeOnFirst = actionCfg.badgeOnFirst;
  const badgeOnThreshold = actionCfg.badgeOnThreshold;

  const user = await _loadUser(userId);

  const nowTs = now();
  const s = user.streaks[actionType] || { count: 0, lastAt: 0 };
  if (s.lastAt && (nowTs - s.lastAt) <= Engine._streakWindowMs) {
    s.count += 1;
  } else {
    s.count = 1;
  }
  s.lastAt = nowTs;
  user.streaks[actionType] = s;

  let pointsToAdd = points;
  if (actionCfg.streakBonus) {
    const f = actionCfg.streakBonus.factor || 0;
    const multiplier = 1 + ((s.count - 1) * f);
    pointsToAdd = Math.round(pointsToAdd * multiplier);
  }

  user.points += pointsToAdd;

  if (badgeOnFirst) {
    if (s.count === 1) _awardBadge(user, badgeOnFirst);
  }

  if (badgeOnThreshold && typeof badgeOnThreshold.threshold === 'number') {
    if (s.count >= badgeOnThreshold.threshold) {
      _awardBadge(user, badgeOnThreshold.badgeId);
    }
  }

  if (actionCfg.badgeOnPoints) {
  user.actionTotals = user.actionTotals || {};
  const current = user.actionTotals[actionType] || 0;
  const newTotal = current + 1;
  user.actionTotals[actionType] = newTotal;

  if (newTotal >= actionCfg.badgeOnPoints.threshold) {
    _awardBadge(user, actionCfg.badgeOnPoints.badgeId);
  }
}

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
  const users = await Engine._store.listUsers();
  const normalized = users.map(u => _ensureUser(u));
  normalized.sort((a, b) => (b[metric] || 0) - (a[metric] || 0));
  return normalized.slice(0, limit).map(u => ({ id: u.id, points: u.points, badges: Array.from(u.badges) }));
}

async function claimReward(userId, rewardId) {
  if (!Engine._schema || !Engine._schema.rewardPools) throw new Error('No rewardPools defined in schema.');
  const reward = Engine._schema.rewardPools.find(r => r.id === rewardId);
  if (!reward) throw new Error('Unknown rewardId');
  const user = await _loadUser(userId);
  if (user.rewardsClaimed.has(rewardId)) throw new Error('Reward already claimed');
  const cost = reward.cost || 0;
  if (user.points < cost) throw new Error('Insufficient points');
  user.points -= cost;
  user.rewardsClaimed.add(rewardId);
  await _saveUser(user);
  return { success: true, remainingPoints: user.points, rewardId };
}

function validateSchema(s) {
  if (!s) return false;
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
  _internal: {
    _engineState: Engine,
    _ensureUser,
    _loadUser,
    _saveUser,
  }
};

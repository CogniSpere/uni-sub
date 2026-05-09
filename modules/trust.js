// trust-axis-full.js
// Production-Grade Trust Axis: Reputation, verification, historical behavior scoring
// Feeds governance, moderation, and federation filtering with rich history

export const version = "1.0.0";

export const metadata = {
  id: "trust-axis",
  name: "Trust Axis",
  description: "Enterprise-grade reputation scoring, verification, and behavior tracking.",
  trust_level: "core"
};

const DEFAULT_SCHEMA = {
  scoring: {
    baselineScore: 0.5, // neutral baseline
    scoreRange: [0, 1],
    eventWeights: {
      positive: 0.05,
      neutral: 0.01,
      negative: -0.1
    },
    decayRatePerDayMs: 0.002, // reputation decays slowly
    decayEnabled: false // enable for time-based decay
  },
  verification: {
    levels: ["unverified", "verified", "trusted", "core"],
    levelUpBoost: { verified: 0.1, trusted: 0.2, core: 0.3 },
    requiresEvidence: false
  },
  escalation: {
    negativeEventThreshold: 3, // escalate to moderation after N negative events
    escalationCooldownMs: 24 * 60 * 60 * 1000 // 24 hours
  }
};

const state = {
  reputationScores: new Map(), // actorId -> { score: 0..1, lastUpdated, trend }
  verificationRecords: new Map(), // actorId -> { level, verifiedAt, verifier, expiresAt, evidence }
  trustHistory: new Map(), // actorId -> [ { type, reason, weight, timestamp, context } ]
  escalations: new Map(), // actorId -> { escalatedAt, lastEscalation, level, reason }
  behaviorPatterns: new Map(), // actorId -> { positiveCount, negativeCount, frequencyPerDay }
  metrics: {
    actorsScored: 0,
    eventsRecorded: 0,
    escalationsTriggered: 0,
    verificationsPerformed: 0,
    reputationChanges: 0
  },
  schema: {}
};

function _computeScore(actorId) {
  const history = state.trustHistory.get(actorId) || [];
  let score = state.schema.scoring.baselineScore;

  // Apply event weights
  for (const event of history) {
    const weight = state.schema.scoring.eventWeights[event.type] || 0;
    score += weight;
  }

  // Apply time decay if enabled
  if (state.schema.scoring.decayEnabled && history.length > 0) {
    const lastEventTime = history[history.length - 1].timestamp;
    const ageMs = Date.now() - lastEventTime;
    const decayFactor = 1 - (ageMs / 86400000) * state.schema.scoring.decayRatePerDayMs;
    score = score * Math.max(0, decayFactor);
  }

  // Clamp to range
  return Math.max(
    state.schema.scoring.scoreRange[0],
    Math.min(state.schema.scoring.scoreRange[1], score)
  );
}

function _updateBehaviorPattern(actorId, eventType) {
  if (!state.behaviorPatterns.has(actorId)) {
    state.behaviorPatterns.set(actorId, {
      positiveCount: 0,
      negativeCount: 0,
      lastEventAt: Date.now(),
      eventsInLastDay: 0
    });
  }

  const pattern = state.behaviorPatterns.get(actorId);

  if (eventType === "positive") {
    pattern.positiveCount++;
  } else if (eventType === "negative") {
    pattern.negativeCount++;
  }

  // Update frequency
  const dayMs = 24 * 60 * 60 * 1000;
  if (Date.now() - pattern.lastEventAt < dayMs) {
    pattern.eventsInLastDay++;
  } else {
    pattern.eventsInLastDay = 1;
  }

  pattern.lastEventAt = Date.now();
}

function _checkEscalation(actorId) {
  const pattern = state.behaviorPatterns.get(actorId);
  if (!pattern) return false;

  if (pattern.negativeCount >= state.schema.escalation.negativeEventThreshold) {
    const escalation = state.escalations.get(actorId);
    
    // Check cooldown
    if (escalation && Date.now() - escalation.lastEscalation < state.schema.escalation.escalationCooldownMs) {
      return false; // Still in cooldown
    }

    return true;
  }

  return false;
}

export default {
  version,
  metadata,

  async init({ Registry }) {
    console.log("[Trust Axis] Initializing...");

    state.schema = DEFAULT_SCHEMA;

    const api = {
      // ===== Event Recording =====

      recordEvent: async (actorId, event) => {
        const { type = "neutral", reason = "", metadata = {} } = event;

        if (!["positive", "negative", "neutral"].includes(type)) {
          return { success: false, reason: "Invalid event type" };
        }

        if (!state.trustHistory.has(actorId)) {
          state.trustHistory.set(actorId, []);
        }

        const entry = {
          type,
          reason,
          weight: state.schema.scoring.eventWeights[type],
          timestamp: Date.now(),
          context: metadata
        };

        state.trustHistory.get(actorId).push(entry);

        // Keep history bounded
        const history = state.trustHistory.get(actorId);
        if (history.length > 1000) {
          history.shift();
        }

        // Update behavior pattern
        _updateBehaviorPattern(actorId, type);

        // Recompute score
        const score = _computeScore(actorId);
        if (!state.reputationScores.has(actorId)) {
          state.reputationScores.set(actorId, { score, lastUpdated: Date.now(), trend: "stable" });
          state.metrics.actorsScored++;
        } else {
          const record = state.reputationScores.get(actorId);
          const previousScore = record.score;
          record.score = score;
          record.lastUpdated = Date.now();
          
          // Compute trend
          if (score > previousScore) {
            record.trend = "improving";
          } else if (score < previousScore) {
            record.trend = "declining";
          } else {
            record.trend = "stable";
          }

          state.metrics.reputationChanges++;
        }

        state.metrics.eventsRecorded++;

        // Check for escalation
        if (_checkEscalation(actorId)) {
          state.escalations.set(actorId, {
            actorId,
            escalatedAt: Date.now(),
            lastEscalation: Date.now(),
            level: "flagged",
            reason: `Negative event threshold exceeded: ${state.behaviorPatterns.get(actorId).negativeCount} events`
          });
          state.metrics.escalationsTriggered++;

          return {
            success: true,
            actorId,
            eventRecorded: true,
            newScore: score,
            escalationTriggered: true,
            escalationLevel: "flagged"
          };
        }

        return {
          success: true,
          actorId,
          eventRecorded: true,
          newScore: score,
          escalationTriggered: false
        };
      },

      // ===== Scoring =====

      getScore: async (actorId) => {
        let record = state.reputationScores.get(actorId);
        
        if (!record) {
          const score = _computeScore(actorId);
          record = { score, lastUpdated: Date.now(), trend: "stable" };
          state.reputationScores.set(actorId, record);
          state.metrics.actorsScored++;
        }

        return record.score;
      },

      // ===== Reputation Queries =====

      getReputation: async (actorId) => {
        const score = await api.getScore(actorId);
        const record = state.reputationScores.get(actorId);
        const verification = state.verificationRecords.get(actorId) || { level: "unverified", verifiedAt: null };
        const history = state.trustHistory.get(actorId) || [];
        const pattern = state.behaviorPatterns.get(actorId) || { positiveCount: 0, negativeCount: 0, eventsInLastDay: 0 };
        const escalation = state.escalations.get(actorId);

        return {
          actorId,
          score,
          scorePercentage: (score * 100).toFixed(2),
          trend: record?.trend || "stable",
          verification,
          historyLength: history.length,
          lastEventAt: history.length > 0 ? history[history.length - 1].timestamp : null,
          behavior: {
            positiveEvents: pattern.positiveCount,
            negativeEvents: pattern.negativeCount,
            eventsInLastDay: pattern.eventsInLastDay,
            positiveRatio: pattern.positiveCount + pattern.negativeCount > 0
              ? (pattern.positiveCount / (pattern.positiveCount + pattern.negativeCount) * 100).toFixed(2)
              : 0
          },
          escalation: escalation ? {
            level: escalation.level,
            reason: escalation.reason,
            escalatedAt: escalation.escalatedAt
          } : null
        };
      },

      getHistory: async (actorId, limit = 50) => {
        const history = state.trustHistory.get(actorId) || [];
        return history.slice(-limit).map(e => ({
          type: e.type,
          reason: e.reason,
          weight: e.weight,
          timestamp: e.timestamp,
          context: e.context
        }));
      },

      // ===== Verification =====

      setVerificationLevel: async (actorId, level, options = {}) => {
        const validLevels = state.schema.verification.levels;
        if (!validLevels.includes(level)) {
          return { success: false, reason: `Invalid verification level: ${level}` };
        }

        const { verifier = "system", evidence = null, expiresInMs = null } = options;

        const expiresAt = expiresInMs ? Date.now() + expiresInMs : null;

        state.verificationRecords.set(actorId, {
          level,
          verifiedAt: Date.now(),
          verifier,
          expiresAt,
          evidence
        });

        // Boost score on verification
        if (level !== "unverified") {
          const boost = state.schema.verification.levelUpBoost[level] || 0;
          const history = state.trustHistory.get(actorId) || [];
          
          if (boost > 0) {
            history.push({
              type: "positive",
              reason: `Verification level set to ${level}`,
              weight: boost,
              timestamp: Date.now(),
              context: { verificationLevel: level, verifier }
            });
            state.trustHistory.set(actorId, history);

            const score = _computeScore(actorId);
            const record = state.reputationScores.get(actorId);
            if (record) {
              record.score = score;
              record.lastUpdated = Date.now();
            }
          }
        }

        state.metrics.verificationsPerformed++;

        return {
          success: true,
          actorId,
          verificationLevel: level,
          verifiedAt: Date.now(),
          expiresAt
        };
      },

      getVerificationLevel: async (actorId) => {
        const record = state.verificationRecords.get(actorId);
        
        if (!record) {
          return { level: "unverified" };
        }

        // Check if expired
        if (record.expiresAt && Date.now() > record.expiresAt) {
          state.verificationRecords.delete(actorId);
          return { level: "unverified" };
        }

        return {
          level: record.level,
          verifiedAt: record.verifiedAt,
          verifier: record.verifier,
          expiresAt: record.expiresAt
        };
      },

      // ===== Leaderboards =====

      leaderboard: async (options = {}) => {
        const { limit = 20, metric = "score", minScore = null, verificationRequired = false } = options;

        let entries = Array.from(state.reputationScores.entries()).map(([id, record]) => ({
          actorId: id,
          score: record.score,
          trend: record.trend,
          verificationLevel: state.verificationRecords.get(id)?.level || "unverified"
        }));

        // Filter
        if (minScore !== null) {
          entries = entries.filter(e => e.score >= minScore);
        }
        if (verificationRequired) {
          entries = entries.filter(e => e.verificationLevel !== "unverified");
        }

        // Sort
        if (metric === "score") {
          entries.sort((a, b) => b.score - a.score);
        } else if (metric === "trend") {
          const trendOrder = { improving: 0, stable: 1, declining: 2 };
          entries.sort((a, b) => trendOrder[a.trend] - trendOrder[b.trend]);
        }

        return entries.slice(0, limit);
      },

      // ===== Escalations =====

      getEscalations: async (filters = {}) => {
        let escalations = Array.from(state.escalations.values());

        if (filters.level) {
          escalations = escalations.filter(e => e.level === filters.level);
        }
        if (filters.since) {
          escalations = escalations.filter(e => e.escalatedAt >= filters.since);
        }

        return escalations;
      },

      clearEscalation: async (actorId) => {
        if (!state.escalations.has(actorId)) {
          return { success: false, reason: "No escalation for this actor" };
        }

        state.escalations.delete(actorId);

        // Reset negative count
        const pattern = state.behaviorPatterns.get(actorId);
        if (pattern) {
          pattern.negativeCount = 0;
        }

        return { success: true, actorId, escalationCleared: true };
      },

      // ===== Metrics =====

      getMetrics: async () => {
        return {
          actorsScored: state.metrics.actorsScored,
          eventsRecorded: state.metrics.eventsRecorded,
          escalationsTriggered: state.metrics.escalationsTriggered,
          verificationsPerformed: state.metrics.verificationsPerformed,
          reputationChanges: state.metrics.reputationChanges,
          activeEscalations: state.escalations.size,
          verifiedActors: Array.from(state.verificationRecords.values())
            .filter(v => v.level !== "unverified").length,
          avgScore: state.reputationScores.size > 0
            ? (Array.from(state.reputationScores.values()).reduce((sum, r) => sum + r.score, 0) / state.reputationScores.size).toFixed(3)
            : 0,
          scoreDistribution: {
            trustworthy: Array.from(state.reputationScores.values()).filter(r => r.score >= 0.7).length,
            neutral: Array.from(state.reputationScores.values()).filter(r => r.score >= 0.3 && r.score < 0.7).length,
            suspicious: Array.from(state.reputationScores.values()).filter(r => r.score < 0.3).length
          }
        };
      }
    };

    Registry.register("trust-axis-api", api);
    return true;
  },

  async shutdown() {
    state.reputationScores.clear();
    state.verificationRecords.clear();
    state.trustHistory.clear();
    state.escalations.clear();
    state.behaviorPatterns.clear();
  }
};

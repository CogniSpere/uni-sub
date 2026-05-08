// trust-axis-full.js
// Production-grade Trust Axis: Reputation, verification levels, behavior tracking

export const version = "1.0.0";

export const metadata = {
  id: "trust-axis",
  name: "Trust Axis",
  description: "Reputation scoring, verification levels, and behavior tracking.",
  trust_level: "core"
};

const state = {
  reputationScores: new Map(),
  verificationRecords: new Map(),
  trustHistory: new Map(),
  escalations: new Map(),
  auditLog: [],
  metrics: {
    eventsRecorded: 0,
    escalationsTriggered: 0,
    verificationsCompleted: 0
  }
};

function _now() { return Date.now(); }
function _generateId(p) { return `${p}_${_now()}_${Math.random().toString(36).substr(2, 6)}`; }
function _auditLog(a, r, res, s, d = {}) {
  state.auditLog.push({ id: _generateId("audit"), timestamp: _now(), action: a, actor: r, resource: res, status: s, details: d });
  if (state.auditLog.length > 5000) state.auditLog.shift();
}

function _computeScore(actorId) {
  const history = state.trustHistory.get(actorId) || [];
  let score = 0.5;
  let positiveCount = 0, negativeCount = 0;
  for (const event of history) {
    if (event.type === "positive") { score += 0.05; positiveCount++; }
    if (event.type === "negative") { score -= 0.1; negativeCount++; }
    if (event.type === "neutral") score += 0.01;
  }
  return {
    score: Math.max(0, Math.min(1, score)),
    positiveCount,
    negativeCount,
    totalEvents: history.length
  };
}

export default {
  version, metadata,

  async init({ Registry, schemaData = {} }) {
    console.log("[Trust Axis] Initializing...");
    const schema = {
      escalationThreshold: 0.3,
      verificationExpiryMs: 365 * 24 * 60 * 60 * 1000,
      ...schemaData
    };

    const api = {
      recordEvent: async (actorId, event) => {
        if (!state.trustHistory.has(actorId)) {
          state.trustHistory.set(actorId, []);
        }
        const entry = {
          type: event.type || "neutral",
          reason: event.reason || "",
          metadata: event.metadata || {},
          timestamp: _now()
        };
        state.trustHistory.get(actorId).push(entry);
        if (state.trustHistory.get(actorId).length > 1000) {
          state.trustHistory.get(actorId).shift();
        }

        const scoreData = _computeScore(actorId);
        if (!state.reputationScores.has(actorId)) {
          state.reputationScores.set(actorId, { ...scoreData });
        } else {
          const current = state.reputationScores.get(actorId);
          Object.assign(current, scoreData);
        }

        // Escalation check
        if (scoreData.negativeCount >= 3 && scoreData.score < schema.escalationThreshold) {
          if (!state.escalations.has(actorId)) {
            state.escalations.set(actorId, {
              triggeredAt: _now(),
              level: scoreData.score < 0.2 ? "critical" : "flagged",
              reason: "Low trust due to negative events"
            });
            state.metrics.escalationsTriggered++;
            _auditLog("escalation_triggered", "system", actorId, "success", { level: state.escalations.get(actorId).level });
          }
        }

        state.metrics.eventsRecorded++;
        return { actorId, newScore: scoreData.score, event: entry };
      },

      score: async (actorId) => {
        if (!state.reputationScores.has(actorId)) {
          const scoreData = _computeScore(actorId);
          state.reputationScores.set(actorId, scoreData);
        }
        return state.reputationScores.get(actorId).score;
      },

      getReputation: async (actorId) => {
        const scoreData = _computeScore(actorId);
        if (!state.reputationScores.has(actorId)) {
          state.reputationScores.set(actorId, scoreData);
        }
        const verification = state.verificationRecords.get(actorId) || { level: "unverified" };
        const history = state.trustHistory.get(actorId) || [];
        return {
          actorId,
          score: scoreData.score,
          positiveCount: scoreData.positiveCount,
          negativeCount: scoreData.negativeCount,
          verification,
          historyLength: history.length,
          escalation: state.escalations.get(actorId) || null,
          trend: scoreData.positiveCount > scoreData.negativeCount ? "improving" : scoreData.negativeCount > 0 ? "declining" : "stable"
        };
      },

      getHistory: async (actorId, limit = 50) => {
        const history = state.trustHistory.get(actorId) || [];
        return history.slice(-limit);
      },

      setVerificationLevel: async (actorId, level) => {
        const valid = ["unverified", "verified", "trusted", "core"].includes(level);
        if (!valid) throw new Error(`Invalid level: ${level}`);
        state.verificationRecords.set(actorId, {
          level,
          verifiedAt: _now(),
          expiresAt: _now() + schema.verificationExpiryMs
        });
        if (level !== "unverified") {
          await api.recordEvent(actorId, {
            type: "positive",
            reason: `Verification level set to ${level}`
          });
        }
        state.metrics.verificationsCompleted++;
        _auditLog("verification_set", "system", actorId, "success", { level });
        return { actorId, verificationLevel: level };
      },

      getVerificationLevel: async (actorId) => {
        const record = state.verificationRecords.get(actorId);
        if (!record) return "unverified";
        if (record.expiresAt && _now() > record.expiresAt) return "unverified";
        return record.level;
      },

      leaderboard: async (limit = 20) => {
        const entries = Array.from(state.reputationScores.entries())
          .map(([id, { score }]) => ({ actorId: id, score }))
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);
        return entries;
      },

      getEscalations: async (filters = {}) => {
        let results = Array.from(state.escalations.entries()).map(([id, e]) => ({ actorId: id, ...e }));
        if (filters.level) results = results.filter(e => e.level === filters.level);
        return results;
      },

      getMetrics: async () => ({ ...state.metrics }),
      getHealthSnapshot: async () => ({
        timestamp: _now(),
        actorsWithReputation: state.reputationScores.size,
        verifiedActors: Array.from(state.verificationRecords.values()).filter(v => v.level !== "unverified").length,
        escalatedActors: state.escalations.size,
        auditLogSize: state.auditLog.length,
        metrics: state.metrics
      })
    };

    Registry.register("trust-axis-api", api);
    return true;
  },

  async shutdown() {
    state.reputationScores.clear();
    state.verificationRecords.clear();
    state.trustHistory.clear();
    state.escalations.clear();
    state.auditLog.length = 0;
  }
};

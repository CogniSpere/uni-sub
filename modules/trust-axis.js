// trust-axis.js
// Trust Axis: Reputation, verification, and historical behaviour scoring
// Feeds governance, moderation, federation filtering

export const version = "0.1.0";

export const metadata = {
  id: "trust-axis",
  name: "Trust Axis",
  description: "Reputation, verification and historical behaviour scoring."
};

const state = {
  reputationScores: new Map(), // actorId -> { score: 0..1, events: [] }
  verificationRecords: new Map(), // actorId -> { level: 'unverified'|'verified'|'trusted', meta: {} }
  trustHistory: new Map() // actorId -> [ { type, value, timestamp } ]
};

function computeScore(actorId) {
  const history = state.trustHistory.get(actorId) || [];
  let score = 0.5; // neutral baseline

  // simple scoring: sum weights of historical events
  for (const event of history) {
    if (event.type === "positive") score += 0.05;
    if (event.type === "negative") score -= 0.1;
    if (event.type === "neutral") score += 0.01;
  }

  return Math.max(0, Math.min(1, score)); // clamp to [0,1]
}

export default {
  version,
  metadata,

  async init({ Registry }) {
    console.log("[Trust Axis] Initializing...");

    const api = {
      // Record a trust-affecting event
      recordEvent: async (actorId, event) => {
        // event: { type: 'positive'|'negative'|'neutral', reason, metadata }
        if (!state.trustHistory.has(actorId)) {
          state.trustHistory.set(actorId, []);
        }

        const entry = {
          type: event.type || "neutral",
          reason: event.reason || "",
          metadata: event.metadata || {},
          timestamp: Date.now()
        };
        state.trustHistory.get(actorId).push(entry);

        // recalculate score
        const score = computeScore(actorId);
        if (!state.reputationScores.has(actorId)) {
          state.reputationScores.set(actorId, { score, events: [] });
        } else {
          state.reputationScores.get(actorId).score = score;
        }

        return { actorId, newScore: score, event: entry };
      },

      // Get current trust score
      score: async (actorId) => {
        if (!state.reputationScores.has(actorId)) {
          const score = computeScore(actorId);
          state.reputationScores.set(actorId, { score, events: [] });
        }
        return state.reputationScores.get(actorId).score;
      },

      // Get full reputation record
      getReputation: async (actorId) => {
        const score = await api.score(actorId);
        const verification = state.verificationRecords.get(actorId) || { level: "unverified", meta: {} };
        const history = state.trustHistory.get(actorId) || [];
        return {
          actorId,
          score,
          verification,
          historyLength: history.length,
          lastEventAt: history.length > 0 ? history[history.length - 1].timestamp : null
        };
      },

      // Get event history
      getHistory: async (actorId, limit = 50) => {
        const history = state.trustHistory.get(actorId) || [];
        return history.slice(-limit);
      },

      // Mark an actor as verified or trusted
      setVerificationLevel: async (actorId, level) => {
        // level: 'unverified' | 'verified' | 'trusted' | 'core'
        const valid = ["unverified", "verified", "trusted", "core"].includes(level);
        if (!valid) throw new Error(`Invalid verification level: ${level}`);

        state.verificationRecords.set(actorId, {
          level,
          meta: { verifiedAt: Date.now(), verifier: "trust-axis" }
        });

        // boost score slightly on verification
        if (level !== "unverified") {
          await api.recordEvent(actorId, {
            type: "positive",
            reason: `Verification level set to ${level}`,
            metadata: { verificationLevel: level }
          });
        }

        return { actorId, verificationLevel: level };
      },

      getVerificationLevel: async (actorId) => {
        const record = state.verificationRecords.get(actorId);
        return record?.level || "unverified";
      },

      // Leaderboard by trust score
      leaderboard: async (limit = 20) => {
        const entries = Array.from(state.reputationScores.entries())
          .map(([id, { score }]) => ({ actorId: id, score }))
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);
        return entries;
      }
    };

    Registry.register("trust-axis-api", api);
    return true;
  },

  async shutdown() {
    state.reputationScores.clear();
    state.verificationRecords.clear();
    state.trustHistory.clear();
  }
};

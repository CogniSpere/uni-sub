// identity-axis.js
// Identity Axis: Pseudonymous IDs, entity linking, and key ownership
// Everything else depends on this being stable

export const version = "0.1.0";

export const metadata = {
  id: "identity-axis",
  name: "Identity Axis",
  description: "Pseudonymous IDs, entity linking, and key ownership."
};

const state = {
  actors: new Map(), // actorId -> { id, pseudonym, keys: Set, verified, createdAt }
  aliases: new Map(), // alias -> canonical actorId
  keyOwnership: new Map(), // publicKey -> actorId
  verifications: new Map() // actorId -> { method, timestamp, verified }
};

function generatePseudonym() {
  return `actor_${Math.random().toString(36).substr(2, 9)}`;
}

export default {
  version,
  metadata,

  async init({ Registry }) {
    console.log("[Identity Axis] Initializing...");

    const api = {
      // Create or retrieve a canonical actor ID
      resolveId: async (input) => {
        if (typeof input !== "string") {
          input = input?.id || String(input);
        }

        // if it's an alias, return the canonical id
        if (state.aliases.has(input)) {
          return state.aliases.get(input);
        }

        // if it's a known actor, return it
        if (state.actors.has(input)) {
          return input;
        }

        // else treat as new actor
        const pseudonym = generatePseudonym();
        const actor = {
          id: pseudonym,
          pseudonym,
          keys: new Set(),
          verified: false,
          createdAt: Date.now()
        };
        state.actors.set(pseudonym, actor);
        state.aliases.set(input, pseudonym); // map the input to this actor
        return pseudonym;
      },

      getActor: async (actorId) => {
        const actor = state.actors.get(actorId);
        if (!actor) return null;
        return {
          ...actor,
          keys: Array.from(actor.keys),
          verification: state.verifications.get(actorId) || null
        };
      },

      // Link multiple identifiers to one actor
      linkEntities: async (primaryActorId, secondaryId) => {
        const canonical = await api.resolveId(primaryActorId);
        state.aliases.set(secondaryId, canonical);
        return { canonical, aliased: secondaryId };
      },

      // Key management
      registerPublicKey: async (actorId, publicKey) => {
        const canonical = await api.resolveId(actorId);
        const actor = state.actors.get(canonical);
        if (!actor) throw new Error(`Actor ${canonical} not found`);

        actor.keys.add(publicKey);
        state.keyOwnership.set(publicKey, canonical);
        return { actorId: canonical, keyRegistered: publicKey };
      },

      getKeyOwner: async (publicKey) => {
        return state.keyOwnership.get(publicKey) || null;
      },

      // Verification
      verifyKeyOwnership: async (actorId, signature, message) => {
        // placeholder: integrate with crypto library
        const canonical = await api.resolveId(actorId);
        const actor = state.actors.get(canonical);
        if (!actor) return { verified: false, reason: "Actor not found" };

        // simplified: trust the signature if at least one key is registered
        if (actor.keys.size === 0) {
          return { verified: false, reason: "No keys registered" };
        }

        // mark as verified
        state.verifications.set(canonical, {
          method: "signature",
          timestamp: Date.now(),
          verified: true
        });
        actor.verified = true;
        return { verified: true, actorId: canonical };
      },

      markVerified: async (actorId, method = "manual") => {
        const canonical = await api.resolveId(actorId);
        const actor = state.actors.get(canonical);
        if (!actor) throw new Error(`Actor ${canonical} not found`);

        actor.verified = true;
        state.verifications.set(canonical, {
          method,
          timestamp: Date.now(),
          verified: true
        });
        return { actorId: canonical, verified: true };
      },

      listActors: async () => {
        return Array.from(state.actors.values()).map(a => ({
          id: a.id,
          pseudonym: a.pseudonym,
          verified: a.verified,
          keysCount: a.keys.size,
          createdAt: a.createdAt
        }));
      }
    };

    Registry.register("identity-axis-api", api);
    return true;
  },

  async shutdown() {
    state.actors.clear();
    state.aliases.clear();
    state.keyOwnership.clear();
    state.verifications.clear();
  }
};

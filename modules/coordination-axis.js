// coordination-axis.js
// Coordination Axis: Federation, CRDTs, peer discovery
// The network topology + agreement layer

export const version = "0.1.0";

export const metadata = {
  id: "coordination-axis",
  name: "Coordination Axis",
  description: "Federation, CRDTs and peer discovery — the network & sync layer."
};

const state = {
  peers: new Map(), // peerId -> { id, url, lastSeen, capabilities: [] }
  syncLog: [], // { from, to, timestamp, status, itemsCount }
  crdtState: new Map() // key -> { value, version, timestamp }
};

export default {
  version,
  metadata,

  async init({ Registry }) {
    console.log("[Coordination Axis] Initializing...");

    const api = {
      // Peer discovery
      registerPeer: async (peerId, peerInfo) => {
        // peerInfo: { url, capabilities }
        state.peers.set(peerId, {
          id: peerId,
          url: peerInfo.url,
          capabilities: peerInfo.capabilities || [],
          registeredAt: Date.now(),
          lastSeen: Date.now()
        });
        return { peerId, registered: true };
      },

      discoverPeers: async (capabilities = []) => {
        const available = [];
        for (const peer of state.peers.values()) {
          // filter by capabilities if specified
          if (
            capabilities.length === 0 ||
            capabilities.some(cap => peer.capabilities.includes(cap))
          ) {
            available.push({
              id: peer.id,
              url: peer.url,
              capabilities: peer.capabilities,
              lastSeen: peer.lastSeen
            });
          }
        }
        return available;
      },

      updatePeerStatus: async (peerId) => {
        const peer = state.peers.get(peerId);
        if (peer) peer.lastSeen = Date.now();
        return { peerId, updated: true };
      },

      // Synchronization
      syncWithPeer: async (localNodeId, remotePeerId, items = []) => {
        const peer = state.peers.get(remotePeerId);
        if (!peer) return { success: false, reason: "Peer not found" };

        // placeholder: in reality, would make HTTP request to peer.url/api/v1/federation/sync
        const syncRecord = {
          from: localNodeId,
          to: remotePeerId,
          timestamp: Date.now(),
          status: "queued",
          itemsCount: items.length
        };
        state.syncLog.push(syncRecord);
        await api.updatePeerStatus(remotePeerId);

        return { success: true, syncId: `${Date.now()}`, itemsQueued: items.length };
      },

      // CRDT operations (Last-Write-Wins simple approach)
      setCRDT: async (key, value) => {
        const version = (state.crdtState.get(key)?.version || 0) + 1;
        const timestamp = Date.now();
        state.crdtState.set(key, { value, version, timestamp });
        return { key, version, timestamp };
      },

      getCRDT: async (key) => {
        const entry = state.crdtState.get(key);
        return entry ? { key, value: entry.value, version: entry.version } : null;
      },

      mergeCRDT: async (localState, remoteState) => {
        // simple last-write-wins merge
        if (remoteState.timestamp > localState.timestamp) {
          return remoteState;
        }
        return localState;
      },

      getSyncLog: async (limit = 50) => {
        return state.syncLog.slice(-limit);
      },

      // Federation manifest
      getManifest: async (nodeId = "local") => {
        return {
          nodeId,
          capabilities: ["federation", "sync", "crdt"],
          endpoints: ["/api/v1/federation/peers", "/api/v1/federation/sync"],
          timestamp: Date.now()
        };
      }
    };

    Registry.register("coordination-axis-api", api);
    return true;
  },

  async shutdown() {
    state.peers.clear();
    state.syncLog.length = 0;
    state.crdtState.clear();
  }
};

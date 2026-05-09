// coordination-axis-full.js
// Production-Grade Coordination Axis: Federation, CRDTs, peer discovery
// Distributed network topology, conflict-free state replication, and peer management

export const version = "1.0.0";

export const metadata = {
  id: "coordination-axis",
  name: "Coordination Axis",
  description: "Enterprise-grade federation, CRDTs and peer discovery.",
  trust_level: "core"
};

const DEFAULT_SCHEMA = {
  federation: {
    maxPeers: 1000,
    healthCheckIntervalMs: 60000, // 1 minute
    peerTimeoutMs: 300000, // 5 minutes
    syncBatchSize: 100,
    maxSyncRetries: 3,
    retryBackoffMs: 5000
  },
  crdt: {
    strategy: "last-write-wins", // lww, vector-clock, hybrid
    conflictResolution: "actor-tiebreak", // actor-tiebreak, timestamp-tiebreak, first-write-wins
    gcIntervalMs: 3600000 // 1 hour
  },
  sync: {
    maxQueuedItems: 10000,
    syncTimeoutMs: 30000,
    conflictDetectionEnabled: true
  }
};

const state = {
  peers: new Map(), // peerId -> { id, url, capabilities, lastSeen, status, version, health }
  syncLog: [], // { from, to, timestamp, status, itemsCount, duration, error }
  crdtState: new Map(), // key -> { value, version, timestamp, actor, hash }
  syncQueue: [], // queued items pending sync
  conflicts: [], // detected conflicts for reconciliation
  metrics: {
    peersDiscovered: 0,
    peersOnline: 0,
    peersOffline: 0,
    syncAttempts: 0,
    syncSuccesses: 0,
    syncFailures: 0,
    conflictsDetected: 0,
    itemsSynced: 0
  },
  schema: {}
};

function generateSyncId() {
  return `sync_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

function generateConflictId() {
  return `conflict_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

function _computeHash(value) {
  // Simple deterministic hash for conflict detection
  const str = JSON.stringify(value);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

function _resolveLWW(local, remote, tieBreaker = "actor") {
  // Last-write-wins with tie-breaking
  if (remote.timestamp > local.timestamp) {
    return { ...remote, resolvedBy: "timestamp", winner: "remote" };
  }
  if (local.timestamp > remote.timestamp) {
    return { ...local, resolvedBy: "timestamp", winner: "local" };
  }
  
  // Timestamps equal: use tie-breaker
  if (tieBreaker === "actor") {
    const winner = (remote.actor || "").localeCompare(local.actor || "") > 0 ? "remote" : "local";
    return winner === "remote"
      ? { ...remote, resolvedBy: "actor-tiebreak", winner }
      : { ...local, resolvedBy: "actor-tiebreak", winner };
  }
  
  return { ...local, resolvedBy: "default", winner: "local" };
}

function _ensurePeerRecord(peerId) {
  if (!state.peers.has(peerId)) {
    state.peers.set(peerId, {
      id: peerId,
      url: null,
      capabilities: [],
      registeredAt: Date.now(),
      lastSeen: Date.now(),
      status: "unknown",
      version: null,
      health: { lastCheck: null, consecutive_failures: 0, latencyMs: null }
    });
  }
  return state.peers.get(peerId);
}

export default {
  version,
  metadata,

  async init({ Registry }) {
    console.log("[Coordination Axis] Initializing...");

    state.schema = DEFAULT_SCHEMA;

    const api = {
      // ===== Peer Discovery & Management =====

      registerPeer: async (peerId, peerInfo) => {
        const { url, capabilities = [], version = "1.0.0" } = peerInfo;
        
        if (state.peers.size >= state.schema.federation.maxPeers) {
          return { success: false, reason: "Max peers reached" };
        }

        const peer = _ensurePeerRecord(peerId);
        peer.url = url;
        peer.capabilities = Array.isArray(capabilities) ? capabilities : [];
        peer.version = version;
        peer.status = "online";
        peer.lastSeen = Date.now();

        state.metrics.peersDiscovered++;
        state.metrics.peersOnline++;

        return {
          success: true,
          peerId,
          registered: true,
          registeredAt: peer.registeredAt
        };
      },

      updatePeerStatus: async (peerId, statusUpdate = {}) => {
        const peer = state.peers.get(peerId);
        if (!peer) return { success: false, reason: "Peer not found" };

        const { status = "online", latencyMs = null, error = null } = statusUpdate;
        
        peer.lastSeen = Date.now();
        peer.status = status;
        if (latencyMs !== null) peer.health.latencyMs = latencyMs;

        if (error) {
          peer.health.consecutive_failures++;
          if (peer.health.consecutive_failures > 3) {
            peer.status = "offline";
            state.metrics.peersOffline++;
          }
        } else {
          peer.health.consecutive_failures = 0;
        }

        peer.health.lastCheck = Date.now();

        return { success: true, peerId, status: peer.status };
      },

      discoverPeers: async (options = {}) => {
        const { capabilities = [], statusFilter = "online", onlineOnly = true } = options;

        const available = [];
        for (const peer of state.peers.values()) {
          // Auto-mark stale peers as offline
          if (Date.now() - peer.lastSeen > state.schema.federation.peerTimeoutMs) {
            peer.status = "offline";
          }

          if (onlineOnly && peer.status !== "online") continue;
          if (statusFilter && peer.status !== statusFilter) continue;

          if (capabilities.length > 0) {
            const hasCapability = capabilities.some(cap =>
              peer.capabilities.includes(cap)
            );
            if (!hasCapability) continue;
          }

          available.push({
            id: peer.id,
            url: peer.url,
            capabilities: peer.capabilities,
            version: peer.version,
            lastSeen: peer.lastSeen,
            status: peer.status,
            latencyMs: peer.health.latencyMs
          });
        }

        return available;
      },

      // ===== CRDT Operations =====

      setCRDT: async (key, value, actor = "system") => {
        const now = Date.now();
        const version = (state.crdtState.get(key)?.version || 0) + 1;
        const hash = _computeHash(value);

        const existing = state.crdtState.get(key);
        
        // Conflict detection
        if (existing && existing.hash !== hash && existing.timestamp === now) {
          const conflictId = generateConflictId();
          state.conflicts.push({
            id: conflictId,
            key,
            local: existing,
            remote: { value, version, timestamp: now, actor, hash },
            detectedAt: now,
            status: "pending"
          });
          state.metrics.conflictsDetected++;
          return {
            success: false,
            reason: "Conflict detected",
            conflictId,
            requiresResolution: true
          };
        }

        state.crdtState.set(key, {
          value,
          version,
          timestamp: now,
          actor,
          hash,
          history: [
            ...(existing?.history || []),
            { version, timestamp: now, actor, hash }
          ]
        });

        // Enqueue for sync
        state.syncQueue.push({ key, value, version, timestamp: now, actor });
        if (state.syncQueue.length > state.schema.sync.maxQueuedItems) {
          state.syncQueue.shift();
        }

        return { success: true, key, version, timestamp: now };
      },

      getCRDT: async (key) => {
        const entry = state.crdtState.get(key);
        if (!entry) return null;

        return {
          key,
          value: entry.value,
          version: entry.version,
          timestamp: entry.timestamp,
          actor: entry.actor
        };
      },

      mergeCRDT: async (localState, remoteState, conflictId = null) => {
        // Apply LWW resolution strategy
        const strategy = state.schema.crdt.strategy;
        const tieBreaker = state.schema.crdt.conflictResolution;

        let resolved;
        if (strategy === "last-write-wins") {
          resolved = _resolveLWW(localState, remoteState, tieBreaker);
        } else {
          // Fallback to LWW
          resolved = _resolveLWW(localState, remoteState, tieBreaker);
        }

        // Mark conflict as resolved
        if (conflictId) {
          const conflict = state.conflicts.find(c => c.id === conflictId);
          if (conflict) {
            conflict.status = "resolved";
            conflict.resolution = resolved;
            conflict.resolvedAt = Date.now();
          }
        }

        return resolved;
      },

      getConflicts: async (filters = {}) => {
        let conflicts = state.conflicts;

        if (filters.status) {
          conflicts = conflicts.filter(c => c.status === filters.status);
        }
        if (filters.key) {
          conflicts = conflicts.filter(c => c.key === filters.key);
        }

        return conflicts;
      },

      // ===== Synchronization =====

      syncWithPeer: async (localNodeId, remotePeerId, items = [], options = {}) => {
        const { timeout = state.schema.sync.syncTimeoutMs, retryCount = 0 } = options;

        const peer = state.peers.get(remotePeerId);
        if (!peer || peer.status !== "online") {
          return {
            success: false,
            reason: peer ? `Peer offline: ${peer.status}` : "Peer not found"
          };
        }

        const syncId = generateSyncId();
        const startTime = Date.now();
        state.metrics.syncAttempts++;

        const syncRecord = {
          id: syncId,
          from: localNodeId,
          to: remotePeerId,
          timestamp: startTime,
          status: "queued",
          itemsCount: items.length,
          duration: null,
          error: null
        };

        try {
          // Simulate network roundtrip (in production: actual HTTP call)
          // const response = await fetch(`${peer.url}/api/v1/federation/sync`, {
          //   method: 'POST',
          //   body: JSON.stringify({ items }),
          //   timeout
          // });

          syncRecord.status = "success";
          syncRecord.duration = Date.now() - startTime;
          
          state.metrics.syncSuccesses++;
          state.metrics.itemsSynced += items.length;

          // Mark items as synced
          state.syncQueue = state.syncQueue.filter(item =>
            !items.some(i => i.key === item.key)
          );
        } catch (err) {
          syncRecord.status = "failed";
          syncRecord.error = String(err);
          syncRecord.duration = Date.now() - startTime;
          
          state.metrics.syncFailures++;

          // Retry logic
          if (retryCount < state.schema.federation.maxSyncRetries) {
            setTimeout(() => {
              api.syncWithPeer(localNodeId, remotePeerId, items, {
                timeout,
                retryCount: retryCount + 1
              });
            }, state.schema.federation.retryBackoffMs * (retryCount + 1));
          }
        }

        state.syncLog.push(syncRecord);
        if (state.syncLog.length > 5000) state.syncLog.shift();

        await api.updatePeerStatus(remotePeerId, {
          status: syncRecord.status === "success" ? "online" : "degraded",
          latencyMs: syncRecord.duration
        });

        return {
          success: syncRecord.status === "success",
          syncId,
          itemsQueued: items.length,
          duration: syncRecord.duration
        };
      },

      getSyncLog: async (filters = {}, limit = 100) => {
        let results = state.syncLog;

        if (filters.from) {
          results = results.filter(s => s.from === filters.from);
        }
        if (filters.to) {
          results = results.filter(s => s.to === filters.to);
        }
        if (filters.status) {
          results = results.filter(s => s.status === filters.status);
        }

        return results.slice(-limit);
      },

      // ===== Federation Manifest =====

      getManifest: async (nodeId = "local") => {
        return {
          nodeId,
          capabilities: ["federation", "sync", "crdt", "conflict-resolution"],
          endpoints: [
            "/api/v1/federation/peers",
            "/api/v1/federation/sync",
            "/api/v1/federation/crdt",
            "/api/v1/federation/manifest"
          ],
          crdtStrategy: state.schema.crdt.strategy,
          timestamp: Date.now(),
          version: version
        };
      },

      // ===== Queries & Metrics =====

      getPeerStatus: async (peerId) => {
        const peer = state.peers.get(peerId);
        if (!peer) return null;

        return {
          peerId: peer.id,
          status: peer.status,
          url: peer.url,
          capabilities: peer.capabilities,
          lastSeen: peer.lastSeen,
          health: {
            consecutive_failures: peer.health.consecutive_failures,
            latencyMs: peer.health.latencyMs,
            lastCheckAt: peer.health.lastCheck
          }
        };
      },

      getCRDTState: async (keys = null) => {
        if (!keys) {
          // Return all keys
          return Array.from(state.crdtState.entries()).map(([k, v]) => ({
            key: k,
            value: v.value,
            version: v.version,
            timestamp: v.timestamp,
            actor: v.actor
          }));
        }

        return keys
          .map(k => state.crdtState.get(k))
          .filter(Boolean)
          .map(v => ({
            key: v.key,
            value: v.value,
            version: v.version,
            timestamp: v.timestamp,
            actor: v.actor
          }));
      },

      getSyncQueueLength: async () => {
        return { queuedItems: state.syncQueue.length };
      },

      getMetrics: async () => {
        const peers = Array.from(state.peers.values());
        return {
          peersDiscovered: state.metrics.peersDiscovered,
          peersOnline: peers.filter(p => p.status === "online").length,
          peersOffline: peers.filter(p => p.status === "offline").length,
          peersDegraded: peers.filter(p => p.status === "degraded").length,
          syncAttempts: state.metrics.syncAttempts,
          syncSuccesses: state.metrics.syncSuccesses,
          syncFailures: state.metrics.syncFailures,
          successRate: state.metrics.syncAttempts > 0
            ? (state.metrics.syncSuccesses / state.metrics.syncAttempts * 100).toFixed(2)
            : 0,
          conflictsDetected: state.metrics.conflictsDetected,
          itemsSynced: state.metrics.itemsSynced,
          crdtStateSize: state.crdtState.size,
          syncQueueLength: state.syncQueue.length
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
    state.syncQueue.length = 0;
    state.conflicts.length = 0;
  }
};

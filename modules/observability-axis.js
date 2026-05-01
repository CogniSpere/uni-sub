// observability-axis.js
// Observability Axis: Audit logs, analytics, debugging
// System transparency and legitimacy

export const version = "0.1.0";

export const metadata = {
  id: "observability-axis",
  name: "Observability Axis",
  description: "Audit logs, analytics and debugging — system transparency."
};

const state = {
  auditLog: [], // { id, entry, timestamp }
  metrics: new Map(), // metricName -> { values: [], tags: {}, timestamps: [] }
  traces: [], // { id, spans: [], startedAt, completedAt }
  debugMode: false
};

function generateAuditId() {
  return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

export default {
  version,
  metadata,

  async init({ Registry }) {
    console.log("[Observability Axis] Initializing...");

    const api = {
      // Audit logging
      audit: async (entry) => {
        // entry: { action, actor, resource, status, metadata }
        const id = generateAuditId();
        state.auditLog.push({
          id,
          timestamp: Date.now(),
          action: entry.action,
          actor: entry.actor || "system",
          resource: entry.resource,
          status: entry.status || "completed",
          metadata: entry.metadata || {}
        });
        return { auditId: id };
      },

      getAuditLog: async (filters = {}, limit = 100) => {
        // filters: { action, actor, status, from, to }
        let results = state.auditLog;

        if (filters.action) {
          results = results.filter(e => e.action === filters.action);
        }
        if (filters.actor) {
          results = results.filter(e => e.actor === filters.actor);
        }
        if (filters.status) {
          results = results.filter(e => e.status === filters.status);
        }
        if (filters.from) {
          results = results.filter(e => e.timestamp >= filters.from);
        }
        if (filters.to) {
          results = results.filter(e => e.timestamp <= filters.to);
        }

        return results.slice(-limit);
      },

      // Metrics recording
      metrics: async (metricName, value, tags = {}) => {
        if (!state.metrics.has(metricName)) {
          state.metrics.set(metricName, { values: [], tags: {}, timestamps: [] });
        }
        const metric = state.metrics.get(metricName);
        metric.values.push(value);
        metric.timestamps.push(Date.now());
        Object.assign(metric.tags, tags);
        return { metricName, value, recorded: true };
      },

      getMetrics: async (metricName) => {
        const metric = state.metrics.get(metricName);
        if (!metric) return null;

        const values = metric.values;
        const sum = values.reduce((a, b) => a + b, 0);
        const avg = values.length > 0 ? sum / values.length : 0;
        const max = values.length > 0 ? Math.max(...values) : 0;
        const min = values.length > 0 ? Math.min(...values) : 0;

        return {
          metricName,
          count: values.length,
          sum,
          avg,
          max,
          min,
          tags: metric.tags,
          latestValue: values[values.length - 1]
        };
      },

      // Tracing
      trace: async (span) => {
        // span: { traceId, spanId, name, startedAt, endedAt, metadata }
        const { traceId } = span;
        let trace = state.traces.find(t => t.id === traceId);

        if (!trace) {
          trace = {
            id: traceId,
            spans: [],
            startedAt: span.startedAt || Date.now(),
            completedAt: null
          };
          state.traces.push(trace);
        }

        trace.spans.push({
          spanId: span.spanId,
          name: span.name,
          duration: (span.endedAt || Date.now()) - (span.startedAt || Date.now()),
          metadata: span.metadata || {}
        });

        return { traceId, spanAdded: true, spanCount: trace.spans.length };
      },

      getTrace: async (traceId) => {
        const trace = state.traces.find(t => t.id === traceId);
        return trace || null;
      },

      // Debug mode
      setDebugMode: async (enabled) => {
        state.debugMode = enabled;
        return { debugMode: enabled };
      },

      isDebugMode: async () => {
        return { debugMode: state.debugMode };
      },

      // System health snapshot
      getHealthSnapshot: async () => {
        const recentAudit = state.auditLog.slice(-100);
        const errorCount = recentAudit.filter(e => e.status === "error").length;
        const uptime = Date.now(); // placeholder

        return {
          timestamp: Date.now(),
          auditLogSize: state.auditLog.length,
          recentErrors: errorCount,
          metricsCount: state.metrics.size,
          tracesCount: state.traces.length,
          debugMode: state.debugMode
        };
      }
    };

    Registry.register("observability-axis-api", api);
    return true;
  },

  async shutdown() {
    state.auditLog.length = 0;
    state.metrics.clear();
    state.traces.length = 0;
  }
};

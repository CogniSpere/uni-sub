// observability-axis-full.js
// Production-Grade Observability Axis: Audit logs, metrics, tracing, health
// Complete system transparency with retention policies and diagnostics

export const version = "1.0.0";

export const metadata = {
  id: "observability-axis",
  name: "Observability Axis",
  description: "Enterprise-grade audit logging, metrics, tracing, and system health.",
  trust_level: "core"
};

const DEFAULT_SCHEMA = {
  audit: {
    retentionMs: 90 * 24 * 60 * 60 * 1000, // 90 days
    severityLevels: ["info", "warning", "error", "critical"],
    maxEntries: 100000,
    samplingRate: 1.0 // 100% sampling by default
  },
  metrics: {
    retentionMs: 30 * 24 * 60 * 60 * 1000, // 30 days
    aggregationWindowMs: 60000, // 1 minute
    maxMetrics: 10000,
    percentiles: [50, 90, 95, 99]
  },
  tracing: {
    samplingRate: 0.1, // 10% of traces
    retentionMs: 7 * 24 * 60 * 60 * 1000, // 7 days
    maxTraces: 50000,
    maxSpansPerTrace: 1000
  },
  health: {
    checkIntervalMs: 60000, // 1 minute
    errorThreshold: 0.1 // 10% error rate triggers warning
  }
};

const state = {
  auditLog: [], // comprehensive event log
  metrics: new Map(), // metricName -> { samples: [], aggregations: {} }
  traces: new Map(), // traceId -> { spans: [], startedAt, completedAt, duration, errors }
  debugMode: false,
  systemStartTime: Date.now(),
  lastHealthCheck: null,
  healthHistory: [], // recent health snapshots
  diagnostics: {
    memoryUsage: 0,
    logSize: 0,
    metricsCount: 0,
    traceCount: 0,
    lastUpdate: Date.now()
  },
  schema: {}
};

function generateAuditId() {
  return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

function generateTraceId() {
  return `trace_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

function _computePercentile(values, percentile) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function _pruneOldRecords(now) {
  // Prune expired audit logs
  state.auditLog = state.auditLog.filter(e => now - e.timestamp < state.schema.audit.retentionMs);
  
  // Prune old traces
  for (const [traceId, trace] of state.traces.entries()) {
    if (now - trace.startedAt > state.schema.tracing.retentionMs) {
      state.traces.delete(traceId);
    }
  }

  // Prune old metric samples
  for (const [metricName, metric] of state.metrics.entries()) {
    metric.samples = metric.samples.filter(s => now - s.timestamp < state.schema.metrics.retentionMs);
    if (metric.samples.length === 0) {
      state.metrics.delete(metricName);
    }
  }
}

function _updateDiagnostics() {
  state.diagnostics.logSize = state.auditLog.length;
  state.diagnostics.metricsCount = state.metrics.size;
  state.diagnostics.traceCount = state.traces.size;
  state.diagnostics.lastUpdate = Date.now();
}

export default {
  version,
  metadata,

  async init({ Registry }) {
    console.log("[Observability Axis] Initializing...");

    state.schema = DEFAULT_SCHEMA;

    const api = {
      // ===== Audit Logging =====

      audit: async (entry) => {
        const { action, actor = "system", resource, status = "completed", severity = "info", metadata = {} } = entry;

        // Apply sampling
        if (Math.random() > state.schema.audit.samplingRate) {
          return { success: true, sampled: true };
        }

        const id = generateAuditId();
        const now = Date.now();

        state.auditLog.push({
          id,
          timestamp: now,
          action,
          actor,
          resource,
          status,
          severity,
          metadata
        });

        // Cap the audit log
        if (state.auditLog.length > state.schema.audit.maxEntries) {
          state.auditLog = state.auditLog.slice(-state.schema.audit.maxEntries);
        }

        return { success: true, auditId: id, sampled: false };
      },

      getAuditLog: async (filters = {}, limit = 100) => {
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
        if (filters.severity) {
          const severities = Array.isArray(filters.severity) ? filters.severity : [filters.severity];
          results = results.filter(e => severities.includes(e.severity));
        }
        if (filters.from) {
          results = results.filter(e => e.timestamp >= filters.from);
        }
        if (filters.to) {
          results = results.filter(e => e.timestamp <= filters.to);
        }

        return results.slice(-limit).reverse();
      },

      // ===== Metrics Recording =====

      recordMetric: async (metricName, value, tags = {}) => {
        if (!state.metrics.has(metricName)) {
          state.metrics.set(metricName, {
            metricName,
            samples: [],
            tags: {},
            aggregations: {}
          });
        }

        const metric = state.metrics.get(metricName);
        const now = Date.now();

        metric.samples.push({
          value: Number(value) || 0,
          timestamp: now,
          tags
        });

        // Cap samples
        if (metric.samples.length > 10000) {
          metric.samples = metric.samples.slice(-10000);
        }

        // Update aggregations
        const values = metric.samples.map(s => s.value);
        metric.aggregations = {
          count: values.length,
          sum: values.reduce((a, b) => a + b, 0),
          avg: values.reduce((a, b) => a + b, 0) / values.length,
          min: Math.min(...values),
          max: Math.max(...values),
          p50: _computePercentile(values, 50),
          p90: _computePercentile(values, 90),
          p95: _computePercentile(values, 95),
          p99: _computePercentile(values, 99)
        };

        Object.assign(metric.tags, tags);

        return { success: true, metricName, value, recorded: true };
      },

      getMetrics: async (metricName) => {
        const metric = state.metrics.get(metricName);
        if (!metric) return null;

        const count = metric.samples.length;
        return {
          metricName,
          count,
          ...metric.aggregations,
          tags: metric.tags,
          latestValue: metric.samples.length > 0 ? metric.samples[metric.samples.length - 1].value : null,
          firstSampleAt: metric.samples.length > 0 ? metric.samples[0].timestamp : null,
          lastSampleAt: metric.samples.length > 0 ? metric.samples[metric.samples.length - 1].timestamp : null
        };
      },

      listMetrics: async () => {
        return Array.from(state.metrics.values()).map(m => ({
          metricName: m.metricName,
          count: m.samples.length,
          aggregations: m.aggregations,
          tags: m.tags
        }));
      },

      // ===== Distributed Tracing =====

      startTrace: async (options = {}) => {
        const traceId = generateTraceId();
        const now = Date.now();

        state.traces.set(traceId, {
          id: traceId,
          spans: [],
          startedAt: now,
          completedAt: null,
          duration: null,
          errors: [],
          metadata: options.metadata || {}
        });

        return { traceId, startedAt: now };
      },

      addSpan: async (traceId, span) => {
        const trace = state.traces.get(traceId);
        if (!trace) return { success: false, reason: "Trace not found" };

        if (trace.spans.length >= state.schema.tracing.maxSpansPerTrace) {
          return { success: false, reason: "Max spans per trace exceeded" };
        }

        const spanEntry = {
          spanId: span.spanId || `span_${Math.random().toString(36).substr(2, 6)}`,
          parentSpanId: span.parentSpanId || null,
          name: span.name,
          startedAt: span.startedAt || Date.now(),
          endedAt: span.endedAt || Date.now(),
          duration: (span.endedAt || Date.now()) - (span.startedAt || Date.now()),
          status: span.status || "ok",
          error: span.error || null,
          metadata: span.metadata || {}
        };

        if (spanEntry.error) {
          trace.errors.push({
            spanId: spanEntry.spanId,
            error: spanEntry.error,
            timestamp: spanEntry.endedAt
          });
        }

        trace.spans.push(spanEntry);

        return { success: true, traceId, spanId: spanEntry.spanId };
      },

      endTrace: async (traceId) => {
        const trace = state.traces.get(traceId);
        if (!trace) return { success: false, reason: "Trace not found" };

        trace.completedAt = Date.now();
        trace.duration = trace.completedAt - trace.startedAt;

        return {
          success: true,
          traceId,
          duration: trace.duration,
          spanCount: trace.spans.length,
          errorCount: trace.errors.length
        };
      },

      getTrace: async (traceId) => {
        const trace = state.traces.get(traceId);
        if (!trace) return null;

        return {
          traceId: trace.id,
          spanCount: trace.spans.length,
          duration: trace.duration,
          startedAt: trace.startedAt,
          completedAt: trace.completedAt,
          spans: trace.spans,
          errors: trace.errors,
          metadata: trace.metadata
        };
      },

      // ===== Debug Mode =====

      setDebugMode: async (enabled) => {
        state.debugMode = enabled;
        if (enabled) {
          await api.audit({
            action: "debug_mode_enabled",
            severity: "warning"
          });
        }
        return { success: true, debugMode: enabled };
      },

      isDebugMode: async () => {
        return { debugMode: state.debugMode };
      },

      // ===== Health & Diagnostics =====

      getHealthSnapshot: async () => {
        const now = Date.now();
        _pruneOldRecords(now);

        const recentAudit = state.auditLog.slice(-1000);
        const errorCount = recentAudit.filter(e => e.severity === "error" || e.severity === "critical").length;
        const uptime = now - state.systemStartTime;

        const healthSnapshot = {
          timestamp: now,
          uptime,
          auditLogSize: state.auditLog.length,
          recentErrors: errorCount,
          errorRate: recentAudit.length > 0 ? (errorCount / recentAudit.length * 100).toFixed(2) : 0,
          metricsCount: state.metrics.size,
          tracesCount: state.traces.size,
          debugMode: state.debugMode,
          status: errorCount / recentAudit.length > state.schema.health.errorThreshold ? "degraded" : "healthy"
        };

        state.lastHealthCheck = healthSnapshot;
        state.healthHistory.push(healthSnapshot);

        // Keep last 100 snapshots
        if (state.healthHistory.length > 100) {
          state.healthHistory.shift();
        }

        return healthSnapshot;
      },

      getDiagnostics: async () => {
        _updateDiagnostics();
        return {
          ...state.diagnostics,
          uptime: Date.now() - state.systemStartTime,
          systemStartTime: state.systemStartTime,
          health: state.lastHealthCheck,
          historyAvailable: state.healthHistory.length
        };
      },

      getHealthHistory: async (limit = 50) => {
        return state.healthHistory.slice(-limit);
      },

      // ===== System Queries =====

      getErrorSummary: async (windowMs = 3600000) => {
        const since = Date.now() - windowMs;
        const recentErrors = state.auditLog.filter(
          e => (e.severity === "error" || e.severity === "critical") && e.timestamp >= since
        );

        const errorsByType = {};
        for (const error of recentErrors) {
          const type = error.action;
          errorsByType[type] = (errorsByType[type] || 0) + 1;
        }

        return {
          window: `${windowMs}ms`,
          totalErrors: recentErrors.length,
          errorsByType,
          errorRate: state.auditLog.filter(e => e.timestamp >= since).length > 0
            ? (recentErrors.length / state.auditLog.filter(e => e.timestamp >= since).length * 100).toFixed(2)
            : 0
        };
      }
    };

    Registry.register("observability-axis-api", api);
    return true;
  },

  async shutdown() {
    state.auditLog.length = 0;
    state.metrics.clear();
    state.traces.clear();
    state.healthHistory.length = 0;
  }
};

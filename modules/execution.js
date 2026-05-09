// execution-axis-full.js
// Production-Grade Execution Axis: Adapters, pipelines, event orchestration
// Mechanical layer connecting everything with full observability and error recovery

export const version = "1.0.0";

export const metadata = {
  id: "execution-axis",
  name: "Execution Axis",
  description: "Enterprise-grade adapters, pipelines and event orchestration.",
  trust_level: "core"
};

const DEFAULT_SCHEMA = {
  adapters: {
    maxConcurrent: 50,
    timeoutMs: 30000,
    retryPolicy: { maxRetries: 3, backoffMs: 1000, backoffMultiplier: 2 }
  },
  pipelines: {
    maxDepth: 100,
    defaultMode: "fail-fast", // fail-fast or continue-on-error
    timeoutMs: 120000
  },
  events: {
    maxListeners: 1000,
    bufferSize: 10000,
    errorIsolation: true
  }
};

const state = {
  adapters: new Map(), // adapterId -> { id, handler, metadata, stats }
  pipelines: new Map(), // pipelineId -> { id, steps, metadata, stats }
  eventSubscribers: new Map(), // topic -> Set<{ id, callback, errorCount }>
  executionLog: [], // { id, type, status, startedAt, completedAt, duration, input, output, error }
  adapterStats: new Map(), // adapterId -> { calls, successes, failures, avgDurationMs, errors }
  pipelineStats: new Map(), // pipelineId -> { calls, successes, failures, avgDurationMs }
  metrics: {
    adapterExecutions: 0,
    pipelineExecutions: 0,
    eventsPublished: 0,
    eventsProcessed: 0,
    errorCount: 0,
    retryCount: 0
  },
  schema: {}
};

function generateExecutionId() {
  return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

function _ensureAdapterStats(adapterId) {
  if (!state.adapterStats.has(adapterId)) {
    state.adapterStats.set(adapterId, {
      adapterId,
      calls: 0,
      successes: 0,
      failures: 0,
      totalDurationMs: 0,
      avgDurationMs: 0,
      minDurationMs: Infinity,
      maxDurationMs: 0,
      errors: []
    });
  }
  return state.adapterStats.get(adapterId);
}

function _ensurePipelineStats(pipelineId) {
  if (!state.pipelineStats.has(pipelineId)) {
    state.pipelineStats.set(pipelineId, {
      pipelineId,
      calls: 0,
      successes: 0,
      failures: 0,
      totalDurationMs: 0,
      avgDurationMs: 0,
      minDurationMs: Infinity,
      maxDurationMs: 0,
      stepsAvg: 0
    });
  }
  return state.pipelineStats.get(pipelineId);
}

async function _executeWithRetry(fn, maxRetries = 3, backoffMs = 1000) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      state.metrics.retryCount++;
      if (attempt < maxRetries - 1) {
        await new Promise(resolve =>
          setTimeout(resolve, backoffMs * Math.pow(2, attempt))
        );
      }
    }
  }
  throw lastError;
}

export default {
  version,
  metadata,

  async init({ Registry }) {
    console.log("[Execution Axis] Initializing...");

    state.schema = DEFAULT_SCHEMA;

    const api = {
      // ===== Adapter Management =====

      registerAdapter: async (adapterId, adapterObj) => {
        const { handler, metadata = {} } = adapterObj;

        if (typeof handler !== "function") {
          throw new Error("Adapter must have an async handler function");
        }

        state.adapters.set(adapterId, {
          id: adapterId,
          handler,
          metadata,
          registeredAt: Date.now(),
          enabled: true
        });

        _ensureAdapterStats(adapterId);

        return { success: true, adapterId, registered: true };
      },

      getAdapter: async (adapterId) => {
        const adapter = state.adapters.get(adapterId);
        if (!adapter) return null;

        const stats = state.adapterStats.get(adapterId);
        return {
          id: adapter.id,
          metadata: adapter.metadata,
          enabled: adapter.enabled,
          stats: {
            calls: stats.calls,
            successes: stats.successes,
            failures: stats.failures,
            successRate: stats.calls > 0 ? (stats.successes / stats.calls * 100).toFixed(2) : 0,
            avgDurationMs: stats.avgDurationMs.toFixed(2),
            minDurationMs: stats.minDurationMs === Infinity ? 0 : stats.minDurationMs,
            maxDurationMs: stats.maxDurationMs,
            lastErrorCount: stats.errors.length
          }
        };
      },

      runAdapter: async (adapterId, input, options = {}) => {
        const adapter = state.adapters.get(adapterId);
        if (!adapter) throw new Error(`Adapter ${adapterId} not found`);

        if (!adapter.enabled) throw new Error(`Adapter ${adapterId} is disabled`);

        const { timeout = state.schema.adapters.timeoutMs, retryCount = 0 } = options;
        const execId = generateExecutionId();
        const startTime = Date.now();
        const stats = _ensureAdapterStats(adapterId);

        stats.calls++;
        state.metrics.adapterExecutions++;

        try {
          let output;

          if (retryCount > 0) {
            output = await _executeWithRetry(
              () => adapter.handler(input),
              retryCount,
              state.schema.adapters.retryPolicy.backoffMs
            );
          } else {
            // Single execution with timeout
            output = await Promise.race([
              adapter.handler(input),
              new Promise((_, reject) =>
                setTimeout(
                  () => reject(new Error(`Adapter timeout after ${timeout}ms`)),
                  timeout
                )
              )
            ]);
          }

          const duration = Date.now() - startTime;
          stats.successes++;
          stats.totalDurationMs += duration;
          stats.avgDurationMs = stats.totalDurationMs / stats.successes;
          stats.minDurationMs = Math.min(stats.minDurationMs, duration);
          stats.maxDurationMs = Math.max(stats.maxDurationMs, duration);

          state.executionLog.push({
            id: execId,
            type: "adapter",
            adapterId,
            status: "success",
            startedAt: startTime,
            completedAt: Date.now(),
            duration,
            input: typeof input === "object" ? JSON.stringify(input) : String(input),
            output: typeof output === "object" ? JSON.stringify(output) : String(output),
            error: null
          });

          if (state.executionLog.length > 10000) state.executionLog.shift();

          return { success: true, execId, output, duration };
        } catch (err) {
          const duration = Date.now() - startTime;
          stats.failures++;

          const errorMsg = String(err);
          stats.errors.push({
            timestamp: Date.now(),
            message: errorMsg
          });
          if (stats.errors.length > 10) stats.errors.shift();

          state.metrics.errorCount++;

          state.executionLog.push({
            id: execId,
            type: "adapter",
            adapterId,
            status: "error",
            startedAt: startTime,
            completedAt: Date.now(),
            duration,
            input: typeof input === "object" ? JSON.stringify(input) : String(input),
            output: null,
            error: errorMsg
          });

          if (state.executionLog.length > 10000) state.executionLog.shift();

          throw err;
        }
      },

      // ===== Pipeline Orchestration =====

      registerPipeline: async (pipelineId, pipelineObj) => {
        const { steps = [], metadata = {}, mode = "fail-fast" } = pipelineObj;

        if (steps.length > state.schema.pipelines.maxDepth) {
          throw new Error(`Pipeline depth ${steps.length} exceeds max ${state.schema.pipelines.maxDepth}`);
        }

        state.pipelines.set(pipelineId, {
          id: pipelineId,
          steps,
          metadata,
          mode,
          registeredAt: Date.now(),
          enabled: true
        });

        _ensurePipelineStats(pipelineId);

        return { success: true, pipelineId, stepsCount: steps.length };
      },

      runPipeline: async (pipelineId, input, options = {}) => {
        const pipeline = state.pipelines.get(pipelineId);
        if (!pipeline) throw new Error(`Pipeline ${pipelineId} not found`);

        if (!pipeline.enabled) throw new Error(`Pipeline ${pipelineId} is disabled`);

        const execId = generateExecutionId();
        const startTime = Date.now();
        const stats = _ensurePipelineStats(pipelineId);
        const stepResults = [];
        const errors = [];
        let current = input;

        stats.calls++;
        state.metrics.pipelineExecutions++;

        try {
          for (let stepIdx = 0; stepIdx < pipeline.steps.length; stepIdx++) {
            const step = pipeline.steps[stepIdx];
            const stepStartTime = Date.now();

            try {
              let stepOutput;

              if (typeof step === "string") {
                // Adapter reference
                const result = await api.runAdapter(step, current, options);
                stepOutput = result.output;
              } else if (typeof step === "object" && step.adapterId) {
                // Adapter object with config
                const result = await api.runAdapter(step.adapterId, current, {
                  timeout: step.timeout,
                  retryCount: step.retryCount
                });
                stepOutput = result.output;
              } else if (typeof step === "function") {
                // Inline function
                stepOutput = await step(current);
              } else {
                throw new Error(`Invalid step type at index ${stepIdx}`);
              }

              const stepDuration = Date.now() - stepStartTime;
              stepResults.push({
                index: stepIdx,
                name: step.name || step,
                status: "success",
                duration: stepDuration,
                output: typeof stepOutput === "object"
                  ? JSON.stringify(stepOutput)
                  : String(stepOutput)
              });

              current = stepOutput;
            } catch (stepErr) {
              const stepDuration = Date.now() - stepStartTime;
              const errorMsg = String(stepErr);

              stepResults.push({
                index: stepIdx,
                name: step.name || step,
                status: "error",
                duration: stepDuration,
                error: errorMsg
              });

              errors.push({ stepIdx, error: errorMsg });

              if (pipeline.mode === "fail-fast") {
                throw stepErr;
              }
              // continue-on-error mode: record and continue
              state.metrics.errorCount++;
            }
          }

          const duration = Date.now() - startTime;
          stats.successes++;
          stats.totalDurationMs += duration;
          stats.avgDurationMs = stats.totalDurationMs / stats.successes;
          stats.stepsAvg = stepResults.reduce((sum, s) => sum + s.duration, 0) / stepResults.length;

          state.executionLog.push({
            id: execId,
            type: "pipeline",
            pipelineId,
            status: errors.length === 0 ? "success" : "partial",
            startedAt: startTime,
            completedAt: Date.now(),
            duration,
            stepsExecuted: stepResults.length,
            stepDetails: stepResults,
            errors: errors.length > 0 ? errors : null
          });

          if (state.executionLog.length > 10000) state.executionLog.shift();

          return {
            success: errors.length === 0,
            execId,
            output: current,
            duration,
            stepResults,
            errors: errors.length > 0 ? errors : null
          };
        } catch (err) {
          const duration = Date.now() - startTime;
          stats.failures++;

          state.metrics.errorCount++;
          state.executionLog.push({
            id: execId,
            type: "pipeline",
            pipelineId,
            status: "error",
            startedAt: startTime,
            completedAt: Date.now(),
            duration,
            stepsExecuted: stepResults.length,
            error: String(err)
          });

          if (state.executionLog.length > 10000) state.executionLog.shift();

          throw err;
        }
      },

      // ===== Event System =====

      subscribe: async (topic, callback, options = {}) => {
        if (!state.eventSubscribers.has(topic)) {
          state.eventSubscribers.set(topic, new Set());
        }

        const subscriberId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        const subscriber = { id: subscriberId, callback, errorCount: 0, options };
        
        state.eventSubscribers.get(topic).add(subscriber);

        return {
          success: true,
          subscriberId,
          topic,
          listeners: state.eventSubscribers.get(topic).size
        };
      },

      unsubscribe: async (topic, subscriberId) => {
        const subs = state.eventSubscribers.get(topic);
        if (!subs) return { success: false, reason: "Topic not found" };

        let removed = false;
        for (const sub of subs) {
          if (sub.id === subscriberId) {
            subs.delete(sub);
            removed = true;
            break;
          }
        }

        return { success: removed, topic, subscriberId };
      },

      publishEvent: async (topic, event, options = {}) => {
        const subs = state.eventSubscribers.get(topic);
        const listeners = subs ? subs.size : 0;
        let notified = 0;
        let errors = [];

        state.metrics.eventsPublished++;

        if (subs && listeners > 0) {
          const promises = [];

          for (const sub of subs) {
            const promise = (async () => {
              try {
                await Promise.race([
                  sub.callback(event),
                  new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("Listener timeout")), 10000)
                  )
                ]);
                notified++;
                state.metrics.eventsProcessed++;
                sub.errorCount = 0;
              } catch (err) {
                sub.errorCount++;
                const errorMsg = `Listener error: ${String(err)}`;
                errors.push({ subscriberId: sub.id, error: errorMsg });

                if (state.schema.events.errorIsolation) {
                  // Error isolation: listener failure doesn't affect others
                  console.error(`[Event] ${topic}/${sub.id}: ${errorMsg}`);
                } else {
                  throw err;
                }
              }
            })();

            promises.push(promise);
          }

          if (options.waitForAll) {
            await Promise.all(promises);
          } else {
            // Non-blocking: fire and forget
            Promise.allSettled(promises);
          }
        }

        return {
          topic,
          event,
          listenersNotified: notified,
          totalListeners: listeners,
          errors: errors.length > 0 ? errors : null
        };
      },

      // ===== Execution Queries =====

      getExecutionLog: async (filters = {}, limit = 100) => {
        let results = state.executionLog;

        if (filters.type) {
          results = results.filter(e => e.type === filters.type);
        }
        if (filters.status) {
          results = results.filter(e => e.status === filters.status);
        }
        if (filters.adapterId) {
          results = results.filter(e => e.adapterId === filters.adapterId);
        }
        if (filters.pipelineId) {
          results = results.filter(e => e.pipelineId === filters.pipelineId);
        }

        return results.slice(-limit);
      },

      getPipelineStats: async (pipelineId) => {
        const stats = state.pipelineStats.get(pipelineId);
        if (!stats) return null;

        return {
          pipelineId: stats.pipelineId,
          calls: stats.calls,
          successes: stats.successes,
          failures: stats.failures,
          successRate: stats.calls > 0 ? (stats.successes / stats.calls * 100).toFixed(2) : 0,
          avgDurationMs: stats.avgDurationMs.toFixed(2),
          minDurationMs: stats.minDurationMs === Infinity ? 0 : stats.minDurationMs,
          maxDurationMs: stats.maxDurationMs,
          avgStepDurationMs: stats.stepsAvg.toFixed(2)
        };
      },

      getMetrics: async () => {
        return {
          adapterExecutions: state.metrics.adapterExecutions,
          pipelineExecutions: state.metrics.pipelineExecutions,
          eventsPublished: state.metrics.eventsPublished,
          eventsProcessed: state.metrics.eventsProcessed,
          errorCount: state.metrics.errorCount,
          retryCount: state.metrics.retryCount,
          registeredAdapters: state.adapters.size,
          registeredPipelines: state.pipelines.size,
          activeEventTopics: state.eventSubscribers.size,
          executionLogSize: state.executionLog.length
        };
      }
    };

    Registry.register("execution-axis-api", api);
    return true;
  },

  async shutdown() {
    state.adapters.clear();
    state.pipelines.clear();
    state.eventSubscribers.clear();
    state.executionLog.length = 0;
    state.adapterStats.clear();
    state.pipelineStats.clear();
  }
};

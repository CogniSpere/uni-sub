// execution-axis.js
// Execution Axis: Adapters, pipelines, eventbus
// The mechanical layer connecting everything

export const version = "0.1.0";

export const metadata = {
  id: "execution-axis",
  name: "Execution Axis",
  description: "Adapters, pipelines and the eventbus — the mechanical layer."
};

const state = {
  adapters: new Map(), // adapterId -> { id, handler, metadata }
  pipelines: new Map(), // pipelineId -> { id, steps: [], metadata }
  eventSubscribers: new Map(), // topic -> Set<callback>
  executionLog: [] // { id, type, status, startedAt, completedAt }
};

function generateExecutionId() {
  return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

export default {
  version,
  metadata,

  async init({ Registry }) {
    console.log("[Execution Axis] Initializing...");

    const api = {
      // Adapter management
      registerAdapter: async (adapterId, adapterObj) => {
        // adapterObj: { handler: async (input) => output, metadata }
        if (typeof adapterObj.handler !== "function") {
          throw new Error("Adapter must have a handler function");
        }
        state.adapters.set(adapterId, {
          id: adapterId,
          handler: adapterObj.handler,
          metadata: adapterObj.metadata || {}
        });
        return { adapterId, registered: true };
      },

      getAdapter: async (adapterId) => {
        const adapter = state.adapters.get(adapterId);
        if (!adapter) return null;
        return {
          id: adapter.id,
          metadata: adapter.metadata
        };
      },

      runAdapter: async (adapterId, input) => {
        const adapter = state.adapters.get(adapterId);
        if (!adapter) throw new Error(`Adapter ${adapterId} not found`);

        const execId = generateExecutionId();
        const startTime = Date.now();

        try {
          const output = await adapter.handler(input);
          const duration = Date.now() - startTime;
          state.executionLog.push({
            id: execId,
            type: "adapter",
            adapterId,
            status: "success",
            startedAt: startTime,
            completedAt: Date.now(),
            duration
          });
          return { execId, output, status: "success" };
        } catch (err) {
          state.executionLog.push({
            id: execId,
            type: "adapter",
            adapterId,
            status: "error",
            error: String(err),
            startedAt: startTime,
            completedAt: Date.now()
          });
          throw err;
        }
      },

      // Pipeline orchestration
      registerPipeline: async (pipelineId, pipeline) => {
        // pipeline: { steps: [ { adapterOrFn, name }, ... ] }
        state.pipelines.set(pipelineId, {
          id: pipelineId,
          steps: pipeline.steps || [],
          metadata: pipeline.metadata || {},
          registeredAt: Date.now()
        });
        return { pipelineId, stepsCount: pipeline.steps.length };
      },

      runPipeline: async (pipelineId, input) => {
        const pipeline = state.pipelines.get(pipelineId);
        if (!pipeline) throw new Error(`Pipeline ${pipelineId} not found`);

        const execId = generateExecutionId();
        const startTime = Date.now();
        let current = input;
        const stepResults = [];

        try {
          for (const step of pipeline.steps) {
            let stepOutput;

            // if step is adapter name, look it up
            if (typeof step === "string") {
              const { output } = await api.runAdapter(step, current);
              stepOutput = output;
            } else if (typeof step === "object" && step.adapterOrFn) {
              if (typeof step.adapterOrFn === "function") {
                stepOutput = await step.adapterOrFn(current);
              } else {
                const { output } = await api.runAdapter(step.adapterOrFn, current);
                stepOutput = output;
              }
            }

            stepResults.push({ name: step.name || step, output: stepOutput });
            current = stepOutput;
          }

          state.executionLog.push({
            id: execId,
            type: "pipeline",
            pipelineId,
            status: "success",
            startedAt: startTime,
            completedAt: Date.now(),
            stepsExecuted: pipeline.steps.length
          });
          return { execId, output: current, status: "success", stepResults };
        } catch (err) {
          state.executionLog.push({
            id: execId,
            type: "pipeline",
            pipelineId,
            status: "error",
            error: String(err),
            startedAt: startTime,
            completedAt: Date.now()
          });
          throw err;
        }
      },

      // Event system
      subscribe: async (topic, callback) => {
        if (!state.eventSubscribers.has(topic)) {
          state.eventSubscribers.set(topic, new Set());
        }
        state.eventSubscribers.get(topic).add(callback);
        return { topic, subscribed: true };
      },

      unsubscribe: async (topic, callback) => {
        const subs = state.eventSubscribers.get(topic);
        if (subs) subs.delete(callback);
        return { topic, unsubscribed: true };
      },

      publishEvent: async (topic, event) => {
        const subs = state.eventSubscribers.get(topic);
        const listeners = subs ? subs.size : 0;

        if (subs) {
          for (const callback of subs) {
            try {
              await callback(event);
            } catch (err) {
              console.error(`Event listener error for ${topic}:`, err);
            }
          }
        }

        return { topic, event, listenersNotified: listeners };
      },

      // Execution log
      getExecutionLog: async (limit = 50) => {
        return state.executionLog.slice(-limit);
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
  }
};

export const Registry = {
  modules: new Map(),

  register(name, module) {
    console.log(`[WCO Registry] Registered module: ${name}`);
    this.modules.set(name, module);
  },

  async broadcast(type, payload, context = {}) {
    for (const [name, module] of this.modules) {
      if (typeof module.onSignal === "function") {
        try {
          await module.onSignal(type, payload, context);
        } catch (err) {
          console.error(`[WCO] Module ${name} failed on ${type}:`, err);
        }
      }
    }
  },

  async notifyStateChanged(newState) {
    for (const [name, module] of this.modules) {
      if (typeof module.onStateChanged === "function") {
        try {
          await module.onStateChanged(newState);
        } catch (err) {
          console.error(`[WCO] Module ${name} failed on state change:`, err);
        }
      }
    }
  }
};

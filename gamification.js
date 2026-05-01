import { Registry } from "../registry.js";

const gamification = {
  async onSignal(type, payload, state) {
    if (type !== "NEW_SIGNAL") return;

    // Example: increment points on any signal
    state.points = (state.points || 0) + 1;
  }
};

Registry.register("gamification", gamification);

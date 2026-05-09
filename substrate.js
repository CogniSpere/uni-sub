import { createSubstrate } from "./substrate-glue.js";

console.log("[WCO] Substrate runtime starting…");

let substratePromise = null;

async function boot() {
  if (!substratePromise) {
    substratePromise = createSubstrate();
  }
  return substratePromise;
}

// Expose globally so any page can use it
window.WCO = {
  getSubstrate: async () => await boot()
};

console.log("[WCO] Substrate runtime ready for connections");

// substrate-glue.js
// Minimal civic substrate kernel / glue layer

import { Registry } from "./registry.js";
import SchemaLoader from "./schema-loader.js";

// Optional: if you want to reuse your existing DNA
async function loadDNA() {
  const dnaUrl = chrome.runtime.getURL("dna.json");
  const dnaRaw = await fetch(dnaUrl).then(r => r.text());
  const { schema, version, warnings } = await SchemaLoader.parseAndValidate(dnaRaw);

  if (!schema) {
    console.error("[Substrate] Invalid DNA schema:", warnings);
    return { schema: null, version: null, warnings };
  }

  if (warnings.length > 0) {
    console.warn("[Substrate] DNA warnings:", warnings);
  }

  return { schema, version, warnings };
}

// Simple event layer on top of Registry.broadcast
const Events = {
  async emit(type, payload = {}, context = {}) {
    // type: 'trust:changed', 'identity:verified', etc.
    return Registry.broadcast(type, payload, context);
  }
};

// Load plugins.json, but now with optional `requires` metadata
async function loadManifest() {
  const url = chrome.runtime.getURL("plugins.json");
  const manifest = await fetch(url).then(r => r.json());
  return manifest.modules || [];
}

// Resolve modules in dependency order
async function resolveAndLoadModules(modules, initContextFactory) {
  const loaded = new Set();

  async function loadWithDeps(mod) {
    if (loaded.has(mod.name)) return;

    const requires = mod.requires || [];
    for (const depName of requires) {
      const dep = modules.find(m => m.name === depName);
      if (dep && !loaded.has(dep.name)) {
        await loadWithDeps(dep);
      }
    }

    // dynamic import
    const moduleExports = await import(chrome.runtime.getURL(mod.file));
    const moduleImpl = moduleExports.default || moduleExports;

    // register in Registry (same as your current pattern)
    Registry.register(mod.name, moduleImpl);

    // init with shared context if available
    if (typeof moduleImpl.init === "function") {
      const ctx = await initContextFactory();
      await moduleImpl.init(ctx);
    }

    console.log(`[Substrate] Loaded module: ${mod.name}`);
    loaded.add(mod.name);
  }

  for (const mod of modules) {
    if (!loaded.has(mod.name)) {
      await loadWithDeps(mod);
    }
  }

  return loaded;
}

// Public entrypoint: create the substrate
export async function createSubstrate() {
  // 1. Load DNA (optional but useful)
  const { schema, version } = await loadDNA();

  // 2. Load manifest
  const modules = await loadManifest();
  // modules can now have:
  // { "name": "trust-axis", "file": "modules/trust-axis.js", "requires": ["identity-axis"] }

  // 3. Shared init context for all modules/axes
  const initContextFactory = async () => ({
    schema,
    version,
    Registry,
    Events
    // you can also pass state/saveState if you want:
    // state: await getLocalState(),
    // saveState: saveLocalState
  });

  // 4. Resolve dependencies + load modules
  const loadedNames = await resolveAndLoadModules(modules, initContextFactory);

  console.log("[Substrate] Loaded modules:", Array.from(loadedNames));

  // 5. Return a unified substrate handle
  return {
    registry: Registry,
    events: Events,
    listModules: () => Array.from(Registry.modules.keys()),
    getModule: (name) => Registry.modules.get(name),
    getApi: (name) => Registry.modules.get(name), // axes usually expose their api as default
    dna: { schema, version }
  };
}

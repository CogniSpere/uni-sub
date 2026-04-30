// module-loader-v2.js
import SchemaLoader from "./schema-loader.js";
import { Registry } from "./registry.js";
import { getLocalState, saveLocalState } from "./storage-helpers.js";

export async function loadModulesWithSchema() {
  // 1. Load DNA
  const dnaUrl = chrome.runtime.getURL("dna.json");
  const dnaRaw = await fetch(dnaUrl).then(r => r.text());
  const { schema, version, warnings } = await SchemaLoader.parseAndValidate(dnaRaw);

  if (!schema) {
    console.error("[WCO Host] Invalid DNA schema:", warnings);
    return;
  }

  if (warnings.length > 0) {
    console.warn("[WCO Host] DNA warnings:", warnings);
  }

  // 2. Load module manifest
  const manifest = await fetch(chrome.runtime.getURL("plugins.json")).then(r => r.json());

  for (const mod of manifest.modules) {
    try {
      const moduleExports = await import(chrome.runtime.getURL(mod.file));

      // 3. Check compatibility
      const compat = moduleExports.compatibility || null;

      if (compat) {
        const min = compat.minSchema || "0.0.0";
        const max = compat.maxSchema || "999.999.999";

        const ok =
          version >= min &&
          version <= max;

        if (!ok) {
          console.warn(
            `[WCO Host] Skipping module ${mod.name}: incompatible with DNA ${version}`
          );
          continue;
        }
      }

      // 4. Register module
      Registry.register(mod.name, moduleExports.default || moduleExports);

      // 5. Initialize module
      if (typeof moduleExports.default?.init === "function") {
        const state = await getLocalState();
        await moduleExports.default.init({
          schema,
          version,
          state,
          saveState: saveLocalState
        });
      }

      console.log(`[WCO Host] Loaded module: ${mod.name}`);

    } catch (err) {
      console.error(`[WCO Host] Failed to load module ${mod.name}:`, err);
    }
  }
}

// truth-axis.js
// Truth / Data Axis: Schemas, validation, migrations, and entity relationships
// The reality layer — defines what is valid and how it's structured

import { SchemaLoader } from "../schema-loader.js";

export const version = "0.1.0";

export const metadata = {
  id: "truth-axis",
  name: "Truth / Data Axis",
  description: "Schemas, validation, migrations, and entity relationships — the reality layer.",
  trust_level: "core"
};

const state = {
  schemas: new Map(), // schemaId -> schema object
  entities: new Map(), // entityId -> entity object
  relationships: new Map(), // relationshipId -> { from, to, type }
  entityIndex: new Map() // quick lookup: entityType -> Set of entityIds
};

export default {
  version,
  metadata,

  async init({ Registry }) {
    console.log("[Truth Axis] Initializing...");

    const api = {
      // Schema management
      registerSchema: async (schemaId, schemaObj) => {
        const validation = SchemaLoader.validate(schemaObj);
        if (!validation.valid) {
          throw new Error(`Schema validation failed: ${validation.errors.join(", ")}`);
        }
        state.schemas.set(schemaId, { ...schemaObj, registeredAt: Date.now() });
        return { schemaId, version: schemaObj.dnaVersion };
      },

      getSchema: async (schemaId) => {
        return state.schemas.get(schemaId) || null;
      },

      // Validation
      validate: async (schemaId, obj) => {
        const schema = state.schemas.get(schemaId);
        if (!schema) return { valid: false, errors: [`Schema ${schemaId} not found`] };

        const errors = [];
        if (!obj || typeof obj !== "object") {
          errors.push("Entity must be an object");
        }
        // basic checks; expand based on schema properties
        if (schema.requiredFields && Array.isArray(schema.requiredFields)) {
          for (const field of schema.requiredFields) {
            if (!(field in obj)) errors.push(`Missing required field: ${field}`);
          }
        }
        return { valid: errors.length === 0, errors };
      },

      // Migrations
      registerMigration: async (fromVersion, toVersion, handler) => {
        SchemaLoader.registerMigration(fromVersion, toVersion, handler);
        return true;
      },

      migrate: async (schemaId, obj, targetVersion) => {
        const schema = state.schemas.get(schemaId);
        if (!schema) throw new Error(`Schema ${schemaId} not found`);
        const fromVersion = obj.version || "0.1.0";
        const result = SchemaLoader.migrate(schema, fromVersion, targetVersion);
        if (!result.success) throw new Error(result.errors[0]);
        return result.migratedSchema;
      },

      // Entity storage
      storeEntity: async (entityId, entityObj) => {
        if (!entityObj.id) entityObj.id = entityId;
        if (!entityObj.type) throw new Error("Entity must have a type");

        state.entities.set(entityId, {
          ...entityObj,
          storedAt: Date.now()
        });

        // index by type
        if (!state.entityIndex.has(entityObj.type)) {
          state.entityIndex.set(entityObj.type, new Set());
        }
        state.entityIndex.get(entityObj.type).add(entityId);
        return { entityId, type: entityObj.type };
      },

      getEntity: async (entityId) => {
        return state.entities.get(entityId) || null;
      },

      listEntitiesByType: async (type) => {
        const ids = state.entityIndex.get(type) || new Set();
        return Array.from(ids).map(id => state.entities.get(id)).filter(Boolean);
      },

      // Relationships
      linkEntities: async (fromId, toId, relationshipType) => {
        const relId = `${fromId}--${relationshipType}-->${toId}`;
        state.relationships.set(relId, {
          id: relId,
          from: fromId,
          to: toId,
          type: relationshipType,
          createdAt: Date.now()
        });
        return { relationshipId: relId };
      },

      getRelationships: async (entityId, direction = "both") => {
        const rels = [];
        for (const rel of state.relationships.values()) {
          if (direction === "outgoing" && rel.from === entityId) rels.push(rel);
          else if (direction === "incoming" && rel.to === entityId) rels.push(rel);
          else if (direction === "both" && (rel.from === entityId || rel.to === entityId)) rels.push(rel);
        }
        return rels;
      },

      resolveRelationships: async (entityId) => {
        const rels = await api.getRelationships(entityId);
        const resolved = [];
        for (const rel of rels) {
          const target = rel.from === entityId ? rel.to : rel.from;
          const entity = await api.getEntity(target);
          resolved.push({ relationship: rel, targetEntity: entity });
        }
        return resolved;
      }
    };

    Registry.register("truth-axis-api", api);
    return true;
  },

  async onStateChanged(newState) {
    // react to global state changes if schema definitions shift
  },

  async shutdown() {
    state.schemas.clear();
    state.entities.clear();
    state.relationships.clear();
    state.entityIndex.clear();
  }
};

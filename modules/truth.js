// truth-axis-full.js
// Production-Grade Truth Axis: Schemas, validation, migrations, entity relationships
// The reality layer — defines what is valid, how it's structured, and tracks data integrity

export const version = "1.0.0";

export const metadata = {
  id: "truth-axis",
  name: "Truth Axis",
  description: "Enterprise-grade schemas, validation, migrations, entity relationships, and data integrity.",
  trust_level: "core"
};

const DEFAULT_SCHEMA = {
  validation: {
    strictMode: true,
    coerceTypes: false,
    allowUnknownFields: false,
    maxFieldsPerSchema: 1000,
    maxNestingDepth: 10
  },
  migrations: {
    trackHistory: true,
    autoApply: false,
    rollbackOnFailure: true,
    versionFormat: "semver" // semver or integer
  },
  entities: {
    maxEntitiesInMemory: 100000,
    indexByType: true,
    indexByRelationship: true,
    enableDuplicateDetection: true
  },
  relationships: {
    maxRelationshipsPerEntity: 10000,
    cascadeDelete: false,
    validateTargetExists: true,
    allowCircular: false
  }
};

const state = {
  schemas: new Map(), // schemaId -> { id, version, fields, constraints, metadata, registeredAt, updatedAt }
  entities: new Map(), // entityId -> { id, type, data, schemaId, version, validatedAt, metadata, createdAt, updatedAt }
  relationships: new Map(), // relationshipId -> { id, from, to, type, metadata, createdAt, direction }
  entityIndex: new Map(), // entityType -> Set<entityId>
  relationshipIndex: new Map(), // entityId -> Set<relationshipId>
  migrations: new Map(), // `${fromVersion}=>${toVersion}` -> handler function
  migrationHistory: [], // audit trail of migrations
  validationLog: [], // audit trail of validation events
  schemaVersions: new Map(), // schemaId -> [ versions ]
  conflicts: [], // detected data conflicts or integrity issues
  metrics: {
    schemasRegistered: 0,
    entitiesStored: 0,
    entitiesValidated: 0,
    validationFailures: 0,
    relationshipsCreated: 0,
    migrationsExecuted: 0,
    migrationsRolledBack: 0,
    conflictsDetected: 0
  },
  schema: {}
};

function generateSchemaId() {
  return `schema_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

function generateEntityId() {
  return `entity_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

function generateRelationshipId() {
  return `rel_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

function generateMigrationId() {
  return `mig_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

function _compareVersions(v1, v2) {
  if (state.schema.migrations.versionFormat === "semver") {
    const parts1 = v1.split(".").map(Number);
    const parts2 = v2.split(".").map(Number);
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }
    return 0;
  } else {
    // Integer format
    return Math.sign(parseInt(v1) - parseInt(v2));
  }
}

function _validateFieldType(value, fieldDef) {
  const { type, required, enum: enumValues, minLength, maxLength, pattern, min, max } = fieldDef;

  if (value === null || value === undefined) {
    return required ? `Field required` : null;
  }

  if (typeof value !== type) {
    if (state.schema.validation.coerceTypes) {
      try {
        if (type === "number") value = Number(value);
        if (type === "boolean") value = Boolean(value);
        if (type === "string") value = String(value);
      } catch (e) {
        return `Type mismatch: expected ${type}, got ${typeof value}`;
      }
    } else {
      return `Type mismatch: expected ${type}, got ${typeof value}`;
    }
  }

  if (enumValues && !enumValues.includes(value)) {
    return `Invalid enum value: ${value}`;
  }

  if (type === "string") {
    if (minLength !== undefined && value.length < minLength) {
      return `String too short: min ${minLength}`;
    }
    if (maxLength !== undefined && value.length > maxLength) {
      return `String too long: max ${maxLength}`;
    }
    if (pattern && !new RegExp(pattern).test(value)) {
      return `String does not match pattern`;
    }
  }

  if (type === "number") {
    if (min !== undefined && value < min) {
      return `Value too small: min ${min}`;
    }
    if (max !== undefined && value > max) {
      return `Value too large: max ${max}`;
    }
  }

  return null;
}

function _validateObject(obj, schema, depth = 0) {
  if (depth > state.schema.validation.maxNestingDepth) {
    return ["Max nesting depth exceeded"];
  }

  const errors = [];

  if (!schema.fields || typeof schema.fields !== "object") {
    return ["Schema has no fields"];
  }

  const fieldCount = Object.keys(obj).length;
  if (fieldCount > state.schema.validation.maxFieldsPerSchema) {
    errors.push(`Too many fields: max ${state.schema.validation.maxFieldsPerSchema}`);
  }

  for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
    if (!(fieldName in obj)) {
      if (fieldDef.required) {
        errors.push(`Missing required field: ${fieldName}`);
      }
      continue;
    }

    const error = _validateFieldType(obj[fieldName], fieldDef);
    if (error) {
      errors.push(`Field '${fieldName}': ${error}`);
    }

    // Nested schema validation
    if (fieldDef.schema && typeof obj[fieldName] === "object") {
      const nestedErrors = _validateObject(obj[fieldName], fieldDef.schema, depth + 1);
      errors.push(...nestedErrors.map(e => `${fieldName}.${e}`));
    }
  }

  if (!state.schema.validation.allowUnknownFields) {
    for (const key of Object.keys(obj)) {
      if (!(key in schema.fields)) {
        errors.push(`Unknown field: ${key}`);
      }
    }
  }

  return errors;
}

function _auditLog(action, actor, resource, status, details = {}) {
  state.validationLog.push({
    id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    action,
    actor: actor || "system",
    resource,
    status,
    timestamp: Date.now(),
    details
  });

  if (state.validationLog.length > 10000) {
    state.validationLog.shift();
  }
}

export default {
  version,
  metadata,

  async init({ Registry }) {
    console.log("[Truth Axis] Initializing...");

    state.schema = DEFAULT_SCHEMA;

    const api = {
      // ===== Schema Management =====

      registerSchema: async (schemaObj) => {
        const { id = generateSchemaId(), version = "1.0.0", fields = {}, constraints = {}, metadata = {} } = schemaObj;

        if (!fields || typeof fields !== "object") {
          return { success: false, reason: "Schema must have fields object" };
        }

        if (Object.keys(fields).length === 0) {
          return { success: false, reason: "Schema must have at least one field" };
        }

        const schemaRecord = {
          id,
          version,
          fields,
          constraints,
          metadata,
          registeredAt: Date.now(),
          updatedAt: Date.now(),
          history: [{ version, registeredAt: Date.now(), actor: "system" }]
        };

        state.schemas.set(id, schemaRecord);

        if (!state.schemaVersions.has(id)) {
          state.schemaVersions.set(id, []);
        }
        state.schemaVersions.get(id).push(version);

        state.metrics.schemasRegistered++;

        _auditLog("schema_registered", "system", id, "success", { version, fieldCount: Object.keys(fields).length });

        return {
          success: true,
          schemaId: id,
          version,
          fieldCount: Object.keys(fields).length
        };
      },

      getSchema: async (schemaId, version = null) => {
        const schema = state.schemas.get(schemaId);
        if (!schema) return null;

        if (version && schema.version !== version) {
          return null;
        }

        return {
          id: schema.id,
          version: schema.version,
          fields: schema.fields,
          constraints: schema.constraints,
          metadata: schema.metadata,
          registeredAt: schema.registeredAt,
          updatedAt: schema.updatedAt
        };
      },

      listSchemas: async (filters = {}, limit = 50) => {
        let schemas = Array.from(state.schemas.values());

        if (filters.search) {
          schemas = schemas.filter(s => s.id.includes(filters.search));
        }

        return schemas.slice(0, limit).map(s => ({
          id: s.id,
          version: s.version,
          fieldCount: Object.keys(s.fields).length,
          registeredAt: s.registeredAt
        }));
      },

      // ===== Validation =====

      validate: async (schemaId, obj, options = {}) => {
        const schema = state.schemas.get(schemaId);
        if (!schema) {
          state.metrics.validationFailures++;
          return { valid: false, errors: [`Schema ${schemaId} not found`] };
        }

        if (!obj || typeof obj !== "object") {
          state.metrics.validationFailures++;
          return { valid: false, errors: ["Entity must be an object"] };
        }

        const errors = _validateObject(obj, schema);
        const valid = errors.length === 0;

        if (valid) {
          state.metrics.entitiesValidated++;
          _auditLog("validation_passed", options.actor || "system", schemaId, "success", { entitySize: JSON.stringify(obj).length });
        } else {
          state.metrics.validationFailures++;
          _auditLog("validation_failed", options.actor || "system", schemaId, "failure", { errors });
        }

        return { valid, errors, schema: schema.id };
      },

      // ===== Entity Storage =====

      storeEntity: async (entityObj, schemaId, options = {}) => {
        if (!schemaId) {
          return { success: false, reason: "Schema ID required" };
        }

        const schema = state.schemas.get(schemaId);
        if (!schema) {
          return { success: false, reason: `Schema ${schemaId} not found` };
        }

        // Validate before storing
        const validation = await api.validate(schemaId, entityObj, options);
        if (!validation.valid) {
          return {
            success: false,
            reason: "Validation failed",
            errors: validation.errors
          };
        }

        const entityId = entityObj.id || generateEntityId();
        const entityType = entityObj.type || "unknown";
        const now = Date.now();

        if (state.entities.size >= state.schema.entities.maxEntitiesInMemory) {
          return { success: false, reason: "Entity storage limit reached" };
        }

        // Check for duplicates
        if (state.schema.entities.enableDuplicateDetection) {
          for (const existing of state.entities.values()) {
            if (existing.type === entityType && JSON.stringify(existing.data) === JSON.stringify(entityObj)) {
              return {
                success: false,
                reason: "Duplicate entity detected",
                duplicateId: existing.id
              };
            }
          }
        }

        state.entities.set(entityId, {
          id: entityId,
          type: entityType,
          data: entityObj,
          schemaId,
          version: schema.version,
          validatedAt: now,
          metadata: options.metadata || {},
          createdAt: now,
          updatedAt: now
        });

        // Index by type
        if (state.schema.entities.indexByType) {
          if (!state.entityIndex.has(entityType)) {
            state.entityIndex.set(entityType, new Set());
          }
          state.entityIndex.get(entityType).add(entityId);
        }

        state.metrics.entitiesStored++;

        _auditLog("entity_stored", options.actor || "system", entityId, "success", {
          type: entityType,
          schemaId
        });

        return {
          success: true,
          entityId,
          type: entityType,
          schemaId,
          createdAt: now
        };
      },

      getEntity: async (entityId) => {
        const entity = state.entities.get(entityId);
        if (!entity) return null;

        return {
          id: entity.id,
          type: entity.type,
          data: entity.data,
          schemaId: entity.schemaId,
          version: entity.version,
          validatedAt: entity.validatedAt,
          metadata: entity.metadata,
          createdAt: entity.createdAt,
          updatedAt: entity.updatedAt
        };
      },

      updateEntity: async (entityId, updates, schemaId = null) => {
        const entity = state.entities.get(entityId);
        if (!entity) return { success: false, reason: "Entity not found" };

        const targetSchemaId = schemaId || entity.schemaId;
        const schema = state.schemas.get(targetSchemaId);
        if (!schema) return { success: false, reason: "Schema not found" };

        // Merge updates
        const merged = { ...entity.data, ...updates };

        // Validate merged object
        const validation = await api.validate(targetSchemaId, merged);
        if (!validation.valid) {
          return {
            success: false,
            reason: "Validation failed",
            errors: validation.errors
          };
        }

        entity.data = merged;
        entity.updatedAt = Date.now();
        entity.version = schema.version;

        _auditLog("entity_updated", "system", entityId, "success", {
          changedFields: Object.keys(updates).length
        });

        return {
          success: true,
          entityId,
          updatedAt: entity.updatedAt
        };
      },

      listEntitiesByType: async (type, limit = 100) => {
        const ids = state.entityIndex.get(type) || new Set();
        return Array.from(ids)
          .slice(0, limit)
          .map(id => state.entities.get(id))
          .filter(Boolean)
          .map(e => ({
            id: e.id,
            type: e.type,
            schemaId: e.schemaId,
            createdAt: e.createdAt
          }));
      },

      // ===== Relationships =====

      linkEntities: async (fromId, toId, relationshipType, metadata = {}) => {
        const fromEntity = state.entities.get(fromId);
        const toEntity = state.entities.get(toId);

        if (!fromEntity || !toEntity) {
          return { success: false, reason: "Source or target entity not found" };
        }

        // Validate target exists
        if (state.schema.relationships.validateTargetExists && !toEntity) {
          return { success: false, reason: "Target entity does not exist" };
        }

        // Check circular relationships
        if (!state.schema.relationships.allowCircular) {
          if (fromId === toId) {
            return { success: false, reason: "Cannot create self-referential relationship" };
          }
        }

        // Check max relationships
        const entityRels = state.relationshipIndex.get(fromId) || new Set();
        if (entityRels.size >= state.schema.relationships.maxRelationshipsPerEntity) {
          return { success: false, reason: "Max relationships per entity exceeded" };
        }

        const relationshipId = generateRelationshipId();

        state.relationships.set(relationshipId, {
          id: relationshipId,
          from: fromId,
          to: toId,
          type: relationshipType,
          metadata,
          createdAt: Date.now(),
          direction: "outgoing"
        });

        // Index relationship
        if (state.schema.relationships.indexByRelationship) {
          if (!state.relationshipIndex.has(fromId)) {
            state.relationshipIndex.set(fromId, new Set());
          }
          state.relationshipIndex.get(fromId).add(relationshipId);

          if (!state.relationshipIndex.has(toId)) {
            state.relationshipIndex.set(toId, new Set());
          }
          state.relationshipIndex.get(toId).add(relationshipId);
        }

        state.metrics.relationshipsCreated++;

        _auditLog("relationship_created", "system", relationshipId, "success", {
          from: fromId,
          to: toId,
          type: relationshipType
        });

        return {
          success: true,
          relationshipId,
          from: fromId,
          to: toId,
          type: relationshipType,
          createdAt: Date.now()
        };
      },

      getRelationships: async (entityId, options = {}) => {
        const { direction = "both", type = null } = options;

        const rels = [];
        for (const rel of state.relationships.values()) {
          if (direction === "outgoing" && rel.from === entityId) rels.push(rel);
          else if (direction === "incoming" && rel.to === entityId) rels.push(rel);
          else if (direction === "both" && (rel.from === entityId || rel.to === entityId)) rels.push(rel);

          if (type && rel.type !== type) continue;
        }

        return rels.map(r => ({
          id: r.id,
          from: r.from,
          to: r.to,
          type: r.type,
          metadata: r.metadata,
          createdAt: r.createdAt
        }));
      },

      resolveRelationships: async (entityId) => {
        const rels = await api.getRelationships(entityId);
        const resolved = [];

        for (const rel of rels) {
          const targetId = rel.from === entityId ? rel.to : rel.from;
          const entity = await api.getEntity(targetId);

          resolved.push({
            relationship: rel,
            targetEntity: entity
          });
        }

        return resolved;
      },

      deleteRelationship: async (relationshipId) => {
        const rel = state.relationships.get(relationshipId);
        if (!rel) return { success: false, reason: "Relationship not found" };

        state.relationships.delete(relationshipId);

        // Update indexes
        if (state.relationshipIndex.has(rel.from)) {
          state.relationshipIndex.get(rel.from).delete(relationshipId);
        }
        if (state.relationshipIndex.has(rel.to)) {
          state.relationshipIndex.get(rel.to).delete(relationshipId);
        }

        _auditLog("relationship_deleted", "system", relationshipId, "success");

        return { success: true, relationshipId };
      },

      // ===== Migrations =====

      registerMigration: async (fromVersion, toVersion, handler) => {
        if (typeof handler !== "function") {
          return { success: false, reason: "Handler must be a function" };
        }

        const key = `${fromVersion}=>${toVersion}`;
        state.migrations.set(key, handler);

        return {
          success: true,
          migrationKey: key,
          fromVersion,
          toVersion
        };
      },

      getMigration: async (fromVersion, toVersion) => {
        const key = `${fromVersion}=>${toVersion}`;
        return state.migrations.has(key);
      },

      migrate: async (schemaId, obj, targetVersion, options = {}) => {
        const schema = state.schemas.get(schemaId);
        if (!schema) return { success: false, reason: `Schema ${schemaId} not found` };

        const fromVersion = obj.version || schema.version;
        const path = [];
        let current = fromVersion;

        // Find migration path
        while (_compareVersions(current, targetVersion) < 0) {
          let found = false;
          for (const [key] of state.migrations.entries()) {
            const [keyFrom, keyTo] = key.split("=>");
            if (keyFrom === current) {
              path.push(keyTo);
              current = keyTo;
              found = true;
              break;
            }
          }
          if (!found) break;
        }

        if (_compareVersions(current, targetVersion) !== 0) {
          return {
            success: false,
            reason: `No migration path from ${fromVersion} to ${targetVersion}`
          };
        }

        let migrated = JSON.parse(JSON.stringify(obj));
        const migrationId = generateMigrationId();

        try {
          for (const step of path) {
            const key = `${migrated.version}=>${step}`;
            const handler = state.migrations.get(key);
            if (handler) {
              migrated = await handler(migrated);
              migrated.version = step;
            }
          }

          state.migrationHistory.push({
            id: migrationId,
            schemaId,
            fromVersion,
            toVersion: targetVersion,
            path,
            status: "success",
            timestamp: Date.now()
          });

          state.metrics.migrationsExecuted++;

          _auditLog("migration_executed", options.actor || "system", schemaId, "success", {
            path: path.join(" -> "),
            fromVersion,
            toVersion: targetVersion
          });

          return {
            success: true,
            migrationId,
            migrated,
            path,
            fromVersion,
            toVersion: targetVersion
          };
        } catch (err) {
          if (state.schema.migrations.rollbackOnFailure) {
            state.metrics.migrationsRolledBack++;

            _auditLog("migration_failed_rollback", options.actor || "system", schemaId, "failure", {
              error: String(err)
            });

            return {
              success: false,
              reason: `Migration failed: ${String(err)}`,
              rolledBack: true
            };
          }

          throw err;
        }
      },

      // ===== Queries =====

      getValidationLog: async (filters = {}, limit = 100) => {
        let results = state.validationLog;

        if (filters.action) {
          results = results.filter(e => e.action === filters.action);
        }
        if (filters.status) {
          results = results.filter(e => e.status === filters.status);
        }
        if (filters.resource) {
          results = results.filter(e => e.resource === filters.resource);
        }

        return results.slice(-limit);
      },

      getMigrationHistory: async (filters = {}, limit = 50) => {
        let results = state.migrationHistory;

        if (filters.schemaId) {
          results = results.filter(m => m.schemaId === filters.schemaId);
        }
        if (filters.status) {
          results = results.filter(m => m.status === filters.status);
        }

        return results.slice(-limit);
      },

      getConflicts: async (filters = {}, limit = 100) => {
        let conflicts = state.conflicts;

        if (filters.type) {
          conflicts = conflicts.filter(c => c.type === filters.type);
        }
        if (filters.status) {
          conflicts = conflicts.filter(c => c.status === filters.status);
        }

        return conflicts.slice(-limit);
      },

      getMetrics: async () => {
        return {
          schemasRegistered: state.metrics.schemasRegistered,
          entitiesStored: state.metrics.entitiesStored,
          entitiesValidated: state.metrics.entitiesValidated,
          validationFailures: state.metrics.validationFailures,
          validationSuccessRate: state.metrics.entitiesValidated + state.metrics.validationFailures > 0
            ? (state.metrics.entitiesValidated / (state.metrics.entitiesValidated + state.metrics.validationFailures) * 100).toFixed(2)
            : 0,
          relationshipsCreated: state.metrics.relationshipsCreated,
          migrationsExecuted: state.metrics.migrationsExecuted,
          migrationsRolledBack: state.metrics.migrationsRolledBack,
          conflictsDetected: state.metrics.conflictsDetected,
          totalEntitiesInMemory: state.entities.size,
          totalRelationships: state.relationships.size,
          entityTypes: state.entityIndex.size,
          registeredMigrations: state.migrations.size
        };
      }
    };

    Registry.register("truth-axis-api", api);
    return true;
  },

  async shutdown() {
    state.schemas.clear();
    state.entities.clear();
    state.relationships.clear();
    state.entityIndex.clear();
    state.relationshipIndex.clear();
    state.migrations.clear();
    state.migrationHistory.length = 0;
    state.validationLog.length = 0;
    state.schemaVersions.clear();
    state.conflicts.length = 0;
  }
};

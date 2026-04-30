// schema-loader.js
// Pure ESM, no dependencies

const migrations = new Map();

function sortKeys(obj) {
  if (Array.isArray(obj)) {
    return obj.map(sortKeys);
  }
  if (obj && typeof obj === "object") {
    return Object.keys(obj)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortKeys(obj[key]);
        return acc;
      }, {});
  }
  return obj;
}

function isSemver(str) {
  return typeof str === "string" && /^\d+\.\d+\.\d+$/.test(str);
}

export const SchemaLoader = {
  validate(schema) {
    const errors = [];

    if (!schema || typeof schema !== "object") {
      return { valid: false, errors: ["Schema must be an object"] };
    }

    if (!isSemver(schema.dnaVersion)) {
      errors.push("dnaVersion must be a valid semver string");
    }

    if (!Array.isArray(schema.badges)) {
      errors.push("badges must be an array");
    }

    if (!Array.isArray(schema.milestones)) {
      errors.push("milestones must be an array");
    }

    if (!Array.isArray(schema.rewardPools)) {
      errors.push("rewardPools must be an array");
    }

    if (typeof schema.actions !== "object") {
      errors.push("actions must be an object");
    }

    // Validate action points
    for (const [type, cfg] of Object.entries(schema.actions || {})) {
      if (typeof cfg.points !== "number" || cfg.points < 0) {
        errors.push(`Action "${type}" must have non-negative points`);
      }
    }

    // Validate badge references
    const badgeIds = new Set(schema.badges.map(b => b.id));
    for (const m of schema.milestones) {
      if (!badgeIds.has(m.badgeId)) {
        errors.push(`Milestone "${m.id}" references unknown badge "${m.badgeId}"`);
      }
    }

    return { valid: errors.length === 0, errors };
  },

  canonicalize(schema) {
    const sorted = sortKeys(schema);
    return JSON.stringify(sorted);
  },

  migrate(schema, fromVersion, toVersion) {
    const key = `${fromVersion}->${toVersion}`;
    const handler = migrations.get(key);

    if (!handler) {
      return { success: false, errors: [`No migration registered for ${key}`] };
    }

    try {
      const migrated = handler(schema);
      return { success: true, migratedSchema: migrated };
    } catch (err) {
      return { success: false, errors: [String(err)] };
    }
  },

  async parseAndValidate(serialized) {
    let schema;

    try {
      schema = typeof serialized === "string" ? JSON.parse(serialized) : serialized;
    } catch (err) {
      return { schema: null, version: null, warnings: ["Invalid JSON"] };
    }

    const { valid, errors } = this.validate(schema);

    return {
      schema,
      version: schema.dnaVersion || null,
      warnings: valid ? [] : errors
    };
  },

  getMigrations() {
    return Object.fromEntries(migrations.entries());
  },

  registerMigration(fromVersion, toVersion, handler) {
    const key = `${fromVersion}->${toVersion}`;
    migrations.set(key, handler);
  }
};

export default SchemaLoader;

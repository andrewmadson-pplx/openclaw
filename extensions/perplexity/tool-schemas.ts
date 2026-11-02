type JsonRecord = Record<string, unknown>;

const SCHEMA_MAP_KEYS = ["properties", "patternProperties", "$defs", "definitions"] as const;
const SCHEMA_VALUE_KEYS = ["items", "additionalProperties", "not"] as const;
const SCHEMA_LIST_KEYS = ["anyOf", "oneOf", "allOf", "prefixItems"] as const;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isObjectSchema(schema: JsonRecord): boolean {
  return Array.isArray(schema.type) ? schema.type.includes("object") : schema.type === "object";
}

// The Agent API rejects object schemas without `properties`, such as string maps.
function ensureObjectProperties(schema: unknown): unknown {
  if (!isRecord(schema)) {
    return schema;
  }
  let next: JsonRecord | undefined;
  const set = (key: string, value: unknown) => {
    if (value !== schema[key]) {
      next ??= { ...schema };
      next[key] = value;
    }
  };
  for (const key of SCHEMA_MAP_KEYS) {
    const map = schema[key];
    if (!isRecord(map)) {
      continue;
    }
    let nextMap: JsonRecord | undefined;
    for (const [name, child] of Object.entries(map)) {
      const normalized = ensureObjectProperties(child);
      if (normalized !== child) {
        nextMap ??= { ...map };
        nextMap[name] = normalized;
      }
    }
    set(key, nextMap ?? map);
  }
  for (const key of SCHEMA_VALUE_KEYS) {
    set(key, ensureObjectProperties(schema[key]));
  }
  for (const key of SCHEMA_LIST_KEYS) {
    const list = schema[key];
    if (Array.isArray(list)) {
      const normalized = list.map(ensureObjectProperties);
      set(key, normalized.some((entry, index) => entry !== list[index]) ? normalized : list);
    }
  }
  if (isObjectSchema(schema) && !isRecord(schema.properties)) {
    set("properties", {});
  }
  return next ?? schema;
}

export function normalizePerplexityToolSchemas<T extends { parameters?: unknown }>(
  tools: T[],
): T[] {
  return tools.map((tool) => {
    const parameters = ensureObjectProperties(tool.parameters);
    return parameters === tool.parameters ? tool : { ...tool, parameters };
  });
}

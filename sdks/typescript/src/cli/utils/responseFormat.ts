/**
 * Bidirectional mapping between the platform's `outputs` array and the local
 * YAML `response_format` block; push and pull must be exact inverses. Flat
 * fields round-trip losslessly; a rich schema becomes one `json_schema` output.
 */

export type CliOutputType = "str" | "float" | "bool" | "json_schema";

export interface CliOutput {
  identifier: string;
  type: CliOutputType;
  json_schema?: Record<string, unknown>;
}

export interface LocalResponseFormat {
  name?: string;
  schema: Record<string, unknown>;
}

/**
 * The CLI default output for an unstructured (plain text) prompt. A prompt
 * with exactly this single output has no structured response and therefore no
 * `response_format` block.
 */
export const DEFAULT_TEXT_OUTPUT: CliOutput = {
  identifier: "output",
  type: "str",
};

const SCALAR_OUTPUT_TO_JSON_TYPE: Record<Exclude<CliOutputType, "json_schema">, string> = {
  str: "string",
  float: "number",
  bool: "boolean",
};

const JSON_TYPE_TO_SCALAR_OUTPUT: Record<string, Exclude<CliOutputType, "json_schema">> = {
  string: "str",
  number: "float",
  integer: "float",
  boolean: "bool",
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Accepts either the canonical local form `{ name?, schema }` or the
 * OpenAI-standard wrapper, normalizing to `{ name?, schema }`. Returns
 * undefined when there is no usable schema.
 */
export const normalizeResponseFormat = (raw: unknown): LocalResponseFormat | undefined => {
  if (!isPlainObject(raw)) return undefined;

  // OpenAI-standard wrapper
  if (raw.type === "json_schema" && isPlainObject(raw.json_schema)) {
    const inner = raw.json_schema;
    if (isPlainObject(inner.schema)) {
      return {
        name: typeof inner.name === "string" ? inner.name : undefined,
        schema: inner.schema,
      };
    }
    return undefined;
  }

  // Canonical local form
  if (isPlainObject(raw.schema)) {
    return {
      name: typeof raw.name === "string" ? raw.name : undefined,
      schema: raw.schema,
    };
  }

  return undefined;
};

/**
 * A "simple flat object schema" has only scalar properties, no extra
 * JSON-schema keywords, and (if present) `required` listing exactly the
 * properties -- these map losslessly to flat platform fields.
 */
export const asFlatFields = (
  schema: Record<string, unknown>,
): { identifier: string; type: Exclude<CliOutputType, "json_schema"> }[] | null => {
  if (schema.type !== "object") return null;
  if (!isPlainObject(schema.properties)) return null;

  const allowedSchemaKeys = new Set(["type", "properties", "required", "additionalProperties"]);
  for (const k of Object.keys(schema)) {
    if (!allowedSchemaKeys.has(k)) return null;
  }

  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
    return null;
  }

  const properties = schema.properties;
  const propertyNames = Object.keys(properties);
  if (propertyNames.length === 0) return null;

  const fields = scalarPropertyFields(properties, propertyNames);
  if (!fields) {
    return null;
  }

  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required)) return null;
    const required = [...(schema.required as unknown[])].toSorted((a, b) =>
      String(a).localeCompare(String(b)),
    );
    const names = [...propertyNames].toSorted();
    if (required.length !== names.length || required.some((r, i) => r !== names[i])) {
      return null;
    }
  }

  return fields;
};

/**
 * Pull direction: reconstruct the local `response_format` block from the
 * platform `outputs` array. Returns undefined for a plain-text prompt so we
 * never invent a schema that wasn't there.
 */
export const outputsToResponseFormat = (
  outputs: CliOutput[] | undefined | null,
  fallbackName?: string,
): LocalResponseFormat | undefined => {
  if (!outputs || outputs.length === 0) return undefined;

  const jsonSchemaOutput = outputs.find((o) => o.type === "json_schema" && o.json_schema);
  if (jsonSchemaOutput?.json_schema) {
    return {
      name: jsonSchemaOutput.identifier,
      schema: jsonSchemaOutput.json_schema,
    };
  }

  // Exactly the CLI default single text output → unstructured, no schema.
  if (
    outputs.length === 1 &&
    outputs[0]!.identifier === DEFAULT_TEXT_OUTPUT.identifier &&
    outputs[0]!.type === DEFAULT_TEXT_OUTPUT.type
  ) {
    return undefined;
  }

  // Flat structured fields → a single-level JSON schema object.
  const properties: Record<string, { type: string }> = {};
  for (const output of outputs) {
    if (output.type === "json_schema") continue;
    properties[output.identifier] = {
      type: SCALAR_OUTPUT_TO_JSON_TYPE[output.type],
    };
  }
  if (Object.keys(properties).length === 0) return undefined;

  return {
    name: fallbackName ?? "output",
    schema: {
      type: "object",
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    },
  };
};

/**
 * Push direction: turns the local `response_format` block back into the
 * platform `outputs` array, the exact inverse of {@link outputsToResponseFormat}.
 * A flat schema expands to flat fields; anything richer becomes one json_schema output.
 */
export const responseFormatToOutputs = (raw: unknown): CliOutput[] | undefined => {
  const rf = normalizeResponseFormat(raw);
  if (!rf) return undefined;

  const flat = asFlatFields(rf.schema);
  if (flat) {
    return flat.map((f) => ({ identifier: f.identifier, type: f.type }));
  }

  return [
    {
      identifier: rf.name ?? "output",
      type: "json_schema",
      json_schema: rf.schema,
    },
  ];
};

function scalarPropertyFields(
  properties: Record<string, unknown>,
  propertyNames: string[],
): { identifier: string; type: Exclude<CliOutputType, "json_schema"> }[] | null {
  const fields: {
    identifier: string;
    type: Exclude<CliOutputType, "json_schema">;
  }[] = [];

  for (const name of propertyNames) {
    const prop = properties[name];
    if (!isPlainObject(prop)) return null;
    for (const k of Object.keys(prop)) {
      if (k !== "type") return null;
    }
    const jsonType = prop.type;
    if (typeof jsonType !== "string") return null;
    const scalar = JSON_TYPE_TO_SCALAR_OUTPUT[jsonType];
    if (!scalar) return null;
    fields.push({ identifier: name, type: scalar });
  }

  return fields;
}

/**
 * The run parameters an agent declares, and the values a call supplies.
 *
 * Three forms are accepted: a definition map, any Standard JSON Schema object
 * (read through `"~standard".jsonSchema`, so zod 4, valibot and arktype work
 * without this package importing them), or a plain JSON Schema. A schema
 * library instance that offers no JSON Schema converter is refused with the
 * three forms named, because the SDK never takes a zod instance as a value.
 */

import type { AgentParameterValue, JsonSchemaObject } from "./protocol";

/** The scalar types a run parameter may hold. */
export type ParameterType = "string" | "number" | "boolean";

/** One entry of the definition map. */
export interface ParameterDefinition {
  /** The value type. Read from `options`, then `default`, else string. */
  type?: ParameterType;
  /** A closed list of accepted values. */
  options?: readonly string[];
  /** The value a run takes when it does not supply one. Without it the parameter is required. */
  default?: AgentParameterValue;
  description?: string;
}

/** Parameters declared by name. */
export type ParameterDefinitions = Record<string, ParameterDefinition>;

/** The Standard JSON Schema converter an object exposes under `"~standard"`. */
export interface StandardJsonSchemaConverter {
  readonly input?: (options: { readonly target: string }) => Record<string, unknown>;
  readonly output?: (options: { readonly target: string }) => Record<string, unknown>;
}

/** Any object that implements the Standard JSON Schema interface. */
export interface StandardJsonSchema {
  readonly "~standard": {
    readonly jsonSchema: StandardJsonSchemaConverter;
  };
}

/** Every form `parameters` accepts. */
export type ParameterInput = ParameterDefinitions | StandardJsonSchema | JsonSchemaObject;

/** One parameter as the platform lists it, derived from the schema. */
export interface ParameterSpec {
  name: string;
  type: ParameterType;
  options?: string[];
  default?: AgentParameterValue;
  description?: string;
  required?: boolean;
}

/** The refusal of a parameter definition or of a value a call supplied. */
export class AgentParameterError extends Error {
  readonly code = "agent_parameter_invalid";
  constructor(message: string) {
    super(message);
    this.name = "AgentParameterError";
  }
}

const ACCEPTED_FORMS =
  "parameters must be a definition map ({ model: { options: [...], default: '...' } }), a Standard JSON Schema object (one with \"~standard\".jsonSchema), or a JSON Schema object ({ type: 'object', properties })";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStandardJsonSchema = (value: unknown): value is StandardJsonSchema => {
  if (!isRecord(value)) return false;
  const standard = value["~standard"];
  return isRecord(standard) && isRecord(standard.jsonSchema);
};

const isJsonSchemaObject = (value: unknown): value is JsonSchemaObject =>
  isRecord(value) && value.type === "object" && isRecord(value.properties);

const isDefinitionMap = (value: unknown): value is ParameterDefinitions =>
  isRecord(value) && Object.values(value).every(isRecord);

const definitionType = (definition: ParameterDefinition): ParameterType => {
  if (definition.type) return definition.type;
  if (definition.options) return "string";
  const value = definition.default;
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "string";
};

const definitionMapToSchema = (definitions: ParameterDefinitions): JsonSchemaObject => {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];
  for (const [name, definition] of Object.entries(definitions)) {
    const property: Record<string, unknown> = { type: definitionType(definition) };
    if (definition.options) property.enum = [...definition.options];
    if (definition.default !== undefined) property.default = definition.default;
    else required.push(name);
    if (definition.description !== undefined) property.description = definition.description;
    properties[name] = property;
  }
  const schema: JsonSchemaObject = { type: "object", properties };
  if (required.length > 0) schema.required = required;
  return schema;
};

const readStandardJsonSchema = (input: StandardJsonSchema): JsonSchemaObject => {
  const converter = input["~standard"].jsonSchema;
  const convert = converter.input ?? converter.output;
  if (typeof convert !== "function") {
    throw new AgentParameterError(`the "~standard".jsonSchema converter has no input function; ${ACCEPTED_FORMS}`);
  }
  const schema = convert({ target: "draft-2020-12" });
  if (!isRecord(schema)) {
    throw new AgentParameterError(`the "~standard".jsonSchema converter returned no object; ${ACCEPTED_FORMS}`);
  }
  return schema;
};

/**
 * The parameter schema the `register` frame carries, from any accepted form.
 * No parameters is an object schema with no properties.
 */
export function toParameterSchema(input: ParameterInput | undefined): JsonSchemaObject {
  if (input === undefined) return { type: "object", properties: {} };
  if (isStandardJsonSchema(input)) return readStandardJsonSchema(input);
  if (isJsonSchemaObject(input)) return input;
  if (isDefinitionMap(input)) return definitionMapToSchema(input);
  throw new AgentParameterError(ACCEPTED_FORMS);
}

const specType = (property: Record<string, unknown>): ParameterType => {
  const type = Array.isArray(property.type)
    ? property.type.find((item) => item !== "null")
    : property.type;
  if (type === "number" || type === "integer") return "number";
  if (type === "boolean") return "boolean";
  return "string";
};

const scalar = (value: unknown): AgentParameterValue | undefined =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? value
    : undefined;

/**
 * The parameters a schema declares, one spec per property, the way the
 * platform lists them. Unsupported property types read as text.
 */
export function parameterSpecsFromSchema(schema: JsonSchemaObject): ParameterSpec[] {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const specs: ParameterSpec[] = [];
  for (const [name, raw] of Object.entries(properties)) {
    const property = isRecord(raw) ? raw : {};
    const spec: ParameterSpec = { name, type: specType(property) };
    const options = Array.isArray(property.enum)
      ? property.enum.filter((item): item is string => typeof item === "string")
      : undefined;
    if (options && options.length > 0) spec.options = options;
    const fallback = scalar(property.default);
    if (fallback !== undefined) spec.default = fallback;
    if (typeof property.description === "string") spec.description = property.description;
    spec.required = fallback === undefined && required.has(name);
    specs.push(spec);
  }
  return specs;
}

const coerce = ({
  spec,
  value,
}: {
  spec: ParameterSpec;
  value: AgentParameterValue;
}): AgentParameterValue => {
  if (spec.type === "number") {
    const asNumber = typeof value === "number" ? value : Number(value);
    if (typeof value === "boolean" || !Number.isFinite(asNumber) || String(value).trim() === "") {
      throw new AgentParameterError(`parameter "${spec.name}" must be a number, got ${JSON.stringify(value)}`);
    }
    return asNumber;
  }
  if (spec.type === "boolean") {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    throw new AgentParameterError(`parameter "${spec.name}" must be true or false, got ${JSON.stringify(value)}`);
  }
  const asString = typeof value === "string" ? value : String(value);
  if (spec.options && !spec.options.includes(asString)) {
    throw new AgentParameterError(
      `parameter "${spec.name}" must be one of ${spec.options.join(", ")}, got ${JSON.stringify(value)}`,
    );
  }
  return asString;
};

/**
 * The values the handler receives: every declared parameter, from the call or
 * from its default. A required parameter with no value, or a value of the
 * wrong type or outside the options, is refused with `agent_parameter_invalid`
 * before the handler runs. Names the schema does not declare pass through.
 */
export function resolveParameterValues({
  specs,
  supplied,
}: {
  specs: ParameterSpec[];
  supplied: Record<string, AgentParameterValue> | undefined;
}): Record<string, AgentParameterValue> {
  const values: Record<string, AgentParameterValue> = { ...(supplied ?? {}) };
  for (const spec of specs) {
    const value = values[spec.name];
    if (value === undefined) {
      if (spec.default !== undefined) {
        values[spec.name] = spec.default;
        continue;
      }
      if (!spec.required) continue;
      throw new AgentParameterError(`parameter "${spec.name}" is required and the run did not supply it`);
    }
    values[spec.name] = coerce({ spec, value });
  }
  return values;
}

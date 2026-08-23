/**
 * Converts the JSON Schema a rpc.discover catalogue carries into a zod
 * schema the MCP SDK can advertise and validate against.
 *
 * The input domain is bounded: these schemas come from the services' own zod
 * schemas via Standard JSON (draft-07), so the constructs below are the ones
 * the management surface actually emits. Anything else degrades to
 * `z.unknown()` rather than failing discovery — validation on the service
 * side is authoritative either way; this schema shapes the client's call,
 * it is never what the service trusts.
 */

import { z } from "zod";

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function withDescription(schema: z.ZodType, source: JsonObject): z.ZodType {
  return typeof source.description === "string"
    ? schema.describe(source.description)
    : schema;
}

function convertString(source: JsonObject): z.ZodType {
  let schema = z.string();
  if (typeof source.minLength === "number") schema = schema.min(source.minLength);
  if (typeof source.maxLength === "number") schema = schema.max(source.maxLength);
  if (source.format === "email") schema = schema.email();
  return withDescription(schema, source);
}

function convertNumber(source: JsonObject): z.ZodType {
  let schema = source.type === "integer" ? z.number().int() : z.number();
  if (typeof source.minimum === "number") schema = schema.min(source.minimum);
  if (typeof source.maximum === "number") schema = schema.max(source.maximum);
  return withDescription(schema, source);
}

function convertArray(source: JsonObject): z.ZodType {
  let schema = z.array(convertSchema(source.items));
  if (typeof source.minItems === "number") schema = schema.min(source.minItems);
  if (typeof source.maxItems === "number") schema = schema.max(source.maxItems);
  return withDescription(schema, source);
}

function convertObject(source: JsonObject): z.ZodType {
  const properties = isObject(source.properties) ? source.properties : {};
  const required = new Set(
    Array.isArray(source.required)
      ? source.required.filter((key): key is string => typeof key === "string")
      : [],
  );

  const shape: Record<string, z.ZodType> = {};
  for (const [key, value] of Object.entries(properties)) {
    const converted = convertSchema(value);
    shape[key] = required.has(key) ? converted : converted.optional();
  }

  // A record: no declared properties, a schema for the values.
  if (
    Object.keys(shape).length === 0 &&
    isObject(source.additionalProperties)
  ) {
    return withDescription(
      z.record(z.string(), convertSchema(source.additionalProperties)),
      source,
    );
  }

  let schema: z.ZodType = z.object(shape);
  if (source.additionalProperties === true) {
    schema = (schema as z.ZodObject<Record<string, z.ZodType>>).passthrough();
  }
  return withDescription(schema, source);
}

function convertUnion(types: unknown[], source: JsonObject): z.ZodType {
  // The nullable spelling: one real type plus `null`.
  const nonNull = types.filter(
    (member) => !(isObject(member) && member.type === "null"),
  );
  if (nonNull.length === 1 && nonNull.length !== types.length) {
    return convertSchema(nonNull[0]).nullable();
  }
  const members = types.map(convertSchema);
  if (members.length === 0) return z.unknown();
  if (members.length === 1) return members[0]!;
  return withDescription(
    z.union(members as [z.ZodType, z.ZodType, ...z.ZodType[]]),
    source,
  );
}

/** Converts one JSON Schema node to zod. Unknown constructs become `z.unknown()`. */
export function convertSchema(source: unknown): z.ZodType {
  if (!isObject(source)) return z.unknown();

  if ("const" in source) {
    return z.literal(source.const as never);
  }
  if (Array.isArray(source.enum)) {
    const values = source.enum;
    if (values.every((value) => typeof value === "string")) {
      return withDescription(z.enum(values as [string, ...string[]]), source);
    }
    return convertUnion(
      values.map((value) => ({ const: value })),
      source,
    );
  }
  if (Array.isArray(source.anyOf)) return convertUnion(source.anyOf, source);
  if (Array.isArray(source.oneOf)) return convertUnion(source.oneOf, source);
  if (Array.isArray(source.type)) return convertUnion(
    source.type.map((type) => ({ ...source, type })),
    source,
  );

  switch (source.type) {
    case "object":
      return convertObject(source);
    case "array":
      return convertArray(source);
    case "string":
      return convertString(source);
    case "number":
    case "integer":
      return convertNumber(source);
    case "boolean":
      return withDescription(z.boolean(), source);
    case "null":
      return z.null();
    default:
      // $ref, formats we do not model, anything new: permissive, never fatal.
      return z.unknown();
  }
}

/**
 * Converts a catalogue operation's input schema into the object schema the
 * MCP SDK advertises. A non-object input (or a conversion that produced no
 * object) yields undefined — the caller registers a no-argument tool.
 */
export function convertInputSchema(
  input: unknown,
): z.ZodObject<Record<string, z.ZodType>> | undefined {
  if (!isObject(input)) return undefined;
  const converted = convertSchema(input);
  return converted instanceof z.ZodObject
    ? (converted as z.ZodObject<Record<string, z.ZodType>>)
    : undefined;
}

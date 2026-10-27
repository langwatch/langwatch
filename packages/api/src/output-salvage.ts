/**
 * What a transport answers when the handler's value breaks its declared output schema: the value
 * with every key the schema does not name dropped. A shape drift is logged and answered, not a
 * 500 (Alex, 2026-10-27); the schema stays the allow-list, so an unnamed key never leaves.
 */
import { z } from "zod";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * The value cut down to what `schema` names. A part the schema accepts is answered as the schema
 * parses it; a part it refuses keeps its own value, with undeclared keys dropped below it.
 */
export function withoutUndeclaredKeys(schema: z.ZodType, value: unknown): unknown {
  const parsed = schema.safeParse(value);

  if (parsed.success) return parsed.data;

  return salvage(schema, value);
}

/** Schemas that wrap one inner schema and add no keys of their own. */
const WRAPPERS = [
  z.ZodOptional,
  z.ZodNullable,
  z.ZodDefault,
  z.ZodReadonly,
  z.ZodNonOptional,
  z.ZodCatch,
] as const;

function innerOf(schema: z.ZodType): z.ZodType | undefined {
  const def: object = schema.def;

  if (WRAPPERS.some((wrapper) => schema instanceof wrapper) && "innerType" in def) {
    return def.innerType as z.ZodType;
  }

  if (schema instanceof z.ZodLazy) return schema.def.getter() as z.ZodType;

  // The handler's value is what goes INTO the pipe.
  if (schema instanceof z.ZodPipe) return schema.def.in as z.ZodType;

  return undefined;
}

function salvage(schema: z.ZodType, value: unknown): unknown {
  const inner = innerOf(schema);

  if (inner) return value == null ? value : withoutUndeclaredKeys(inner, value);

  if (schema instanceof z.ZodObject) return salvageObject(schema, value);

  if (schema instanceof z.ZodArray) return salvageArray(schema, value);

  if (schema instanceof z.ZodRecord) return salvageRecord(schema, value);

  if (schema instanceof z.ZodUnion) return salvageUnion(schema.options as z.ZodType[], value);

  if (schema instanceof z.ZodIntersection) return salvageIntersection(schema, value);

  // A leaf (a string, a number, an enum, unknown): it carries no keys to drop.
  return value;
}

function salvageArray(schema: z.ZodArray, value: unknown): unknown {
  if (!Array.isArray(value)) return value;

  return value.map((item) => withoutUndeclaredKeys(schema.element as z.ZodType, item));
}

function salvageRecord(schema: z.ZodRecord, value: unknown): unknown {
  if (!isPlainObject(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      withoutUndeclaredKeys(schema.valueType as z.ZodType, item),
    ]),
  );
}

function salvageIntersection(schema: z.ZodIntersection, value: unknown): unknown {
  const left = withoutUndeclaredKeys(schema.def.left as z.ZodType, value);
  const right = withoutUndeclaredKeys(schema.def.right as z.ZodType, value);

  return isPlainObject(left) && isPlainObject(right) ? { ...left, ...right } : left;
}

function salvageObject(schema: z.ZodObject, value: unknown): unknown {
  if (!isPlainObject(value)) return value;

  const shape = schema.shape as Record<string, z.ZodType>;
  const others = otherKeysOf(schema);
  const kept: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value)) {
    const field = Object.hasOwn(shape, key) ? shape[key] : others;

    if (field) kept[key] = withoutUndeclaredKeys(field, item);
  }

  return kept;
}

/** The schema an object's unnamed keys answer to, or none when it drops them. */
function otherKeysOf(schema: z.ZodObject): z.ZodType | undefined {
  const catchall = schema.def.catchall as z.ZodType | undefined;

  return catchall instanceof z.ZodNever ? undefined : catchall;
}

/**
 * A union answers through the first option that accepts the value. When none does, an object
 * keeps the keys any object option names, each cut by the first option that names it.
 */
function salvageUnion(options: z.ZodType[], value: unknown): unknown {
  for (const option of options) {
    const parsed = option.safeParse(value);

    if (parsed.success) return parsed.data;
  }

  if (!isPlainObject(value)) return value;

  const objects = options.filter((option): option is z.ZodObject => option instanceof z.ZodObject);
  const kept: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value)) {
    const owner = objects.find((option) => Object.hasOwn(option.shape, key));

    if (owner) kept[key] = withoutUndeclaredKeys(owner.shape[key] as z.ZodType, item);
  }

  return kept;
}

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
  z.ZodPrefault,
] as const;

function innerOf(schema: z.ZodType): z.ZodType | undefined {
  const def: object = schema.def;

  if (WRAPPERS.some((wrapper) => schema instanceof wrapper) && "innerType" in def) {
    return def.innerType as z.ZodType;
  }

  if (schema instanceof z.ZodLazy) return schema.def.getter() as z.ZodType;

  // A pipe or codec answers what its output side names; a transform there is unknowable.
  if (schema instanceof z.ZodPipe || schema instanceof z.ZodCodec) {
    return schema.def.out instanceof z.ZodTransform ? NOTHING : (schema.def.out as z.ZodType);
  }

  return undefined;
}

/** Names a value nothing may be answered for: the salvage keeps none of it. */
const NOTHING = z.never();

function salvage(schema: z.ZodType, value: unknown): unknown {
  const inner = innerOf(schema);

  if (inner) return value == null ? value : withoutUndeclaredKeys(inner, value);

  if (schema instanceof z.ZodObject) return salvageObject(schema, value);

  if (schema instanceof z.ZodArray) return salvageArray(schema, value);

  if (schema instanceof z.ZodRecord) return salvageRecord(schema, value);

  if (schema instanceof z.ZodUnion) return salvageUnion(schema, value);

  if (schema instanceof z.ZodIntersection) return salvageIntersection(schema, value);

  if (schema instanceof z.ZodUnknown || schema instanceof z.ZodAny) return value;

  // A leaf that refused its value (a string where a boolean is named, an object where a string
  // is): the schema bounds a named field's value as well as its keys, so it is dropped.
  return undefined;
}

function salvageArray(schema: z.ZodArray, value: unknown): unknown {
  if (!Array.isArray(value)) return undefined;

  return value.map((item) => withoutUndeclaredKeys(schema.element as z.ZodType, item));
}

function salvageRecord(schema: z.ZodRecord, value: unknown): unknown {
  if (!isPlainObject(value)) return undefined;

  const keyType = schema.keyType as z.ZodType;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => keyType.validate(key))
      .map(([key, item]) => [key, withoutUndeclaredKeys(schema.valueType as z.ZodType, item)]),
  );
}

function salvageIntersection(schema: z.ZodIntersection, value: unknown): unknown {
  const left = withoutUndeclaredKeys(schema.def.left as z.ZodType, value);
  const right = withoutUndeclaredKeys(schema.def.right as z.ZodType, value);

  if (isPlainObject(left) && isPlainObject(right)) return { ...left, ...right };

  return isPlainObject(left) || isPlainObject(right) ? undefined : left;
}

function salvageObject(schema: z.ZodObject, value: unknown): unknown {
  if (!isPlainObject(value)) return undefined;

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
 * A union answers through the first option that accepts the value. When none does, the value is
 * cut by the ONE object option that names most of its keys, never by a merge of several.
 */
function salvageUnion(schema: z.ZodUnion, value: unknown): unknown {
  const options = schema.options as z.ZodType[];

  for (const option of options) {
    const parsed = option.safeParse(value);

    if (parsed.success) return parsed.data;
  }

  if (!isPlainObject(value)) return salvageUnionLeaf(options, value);

  const closest =
    discriminatedOption(schema, value) ?? closestObjectOption(options, Object.keys(value));

  return closest ? salvageObject(closest, value) : undefined;
}

/** The option a discriminated union's tag picks, when the tag is one it declares. */
function discriminatedOption(
  schema: z.ZodUnion,
  value: Record<string, unknown>,
): z.ZodObject | undefined {
  if (!(schema instanceof z.ZodDiscriminatedUnion)) return undefined;

  const tag = schema.def.discriminator;

  return (schema.options as z.ZodType[]).find(
    (option): option is z.ZodObject =>
      option instanceof z.ZodObject &&
      Object.hasOwn(option.shape, tag) &&
      (option.shape[tag] as z.ZodType).validate(value[tag]),
  );
}

function closestObjectOption(options: z.ZodType[], keys: string[]): z.ZodObject | undefined {
  let closest: z.ZodObject | undefined;
  let closestNamed = -1;

  for (const option of options) {
    if (!(option instanceof z.ZodObject)) continue;

    const named = keys.filter((key) => Object.hasOwn(option.shape, key)).length;

    if (named > closestNamed) [closest, closestNamed] = [option, named];
  }

  return closest;
}

function salvageUnionLeaf(options: z.ZodType[], value: unknown): unknown {
  const list = options.find((option): option is z.ZodArray => option instanceof z.ZodArray);

  return Array.isArray(value) && list ? salvageArray(list, value) : undefined;
}

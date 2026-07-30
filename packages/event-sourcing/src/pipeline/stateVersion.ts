import type { z } from "zod";
import { ConfigurationError } from "../errors";

/**
 * Derives a fold's state version from its zod schema (ADR-105 decision 9).
 *
 * A fold's version stamp exists so a stale stored row can never decode into
 * the current shape's meaning. Hand-written version constants make that a
 * promise someone has to remember to keep. Deriving the stamp from the schema
 * itself removes the step a person can forget: change a field's type and the
 * hash moves with it, with no separate action required.
 *
 * The hash walks a *normalised* structural summary of the schema — sorted
 * object keys, type identity only. It deliberately excludes anything that is
 * documentation rather than shape: `.describe()` text, default *values*
 * (though not the presence of a `.default()` wrapper, which does change how
 * `undefined` decodes), and key order. Two schemas that differ only in those
 * respects must hash identically; two that differ in a field's type must not.
 */

/** A schema this module cannot walk into a normalised summary. */
type KnownDef =
  | z.ZodStringDef
  | z.ZodNumberDef
  | z.ZodBooleanDef
  | z.ZodDateDef
  | z.ZodBigIntDef
  | z.ZodAnyDef
  | z.ZodUnknownDef
  | z.ZodNullDef
  | z.ZodUndefinedDef
  | z.ZodVoidDef
  | z.ZodArrayDef
  | z.ZodObjectDef
  | z.ZodOptionalDef
  | z.ZodNullableDef
  | z.ZodDefaultDef
  | z.ZodRecordDef
  | z.ZodMapDef
  | z.ZodSetDef
  | z.ZodTupleDef<z.ZodTupleItems, z.ZodTypeAny | null>
  | z.ZodUnionDef
  | z.ZodDiscriminatedUnionDef<string>
  | z.ZodLiteralDef
  | z.ZodEnumDef
  | z.ZodNativeEnumDef
  | z.ZodLazyDef
  | z.ZodEffectsDef
  | z.ZodBrandedDef<z.ZodTypeAny>
  | z.ZodReadonlyDef;

const PRIMITIVE_LABELS = {
  ZodString: "string",
  ZodNumber: "number",
  ZodBoolean: "boolean",
  ZodDate: "date",
  ZodBigInt: "bigint",
  ZodAny: "any",
  ZodUnknown: "unknown",
  ZodNull: "null",
  ZodUndefined: "undefined",
  ZodVoid: "void",
} as const;

/** Stands in for a schema already being walked — see `normalise`. */
const CYCLE_MARKER = "~cycle~";

/**
 * Renders one primitive literal's value into the summary. `typeof` is
 * prefixed so `literal(1)` and `literal("1")` never collide, and `bigint` /
 * `undefined` are handled by hand because `JSON.stringify` cannot render them.
 */
function normaliseLiteralValue(value: unknown): string {
  if (typeof value === "bigint") return `bigint:${value.toString()}n`;
  if (typeof value === "undefined") return "undefined:undefined";
  return `${typeof value}:${JSON.stringify(value)}`;
}

/**
 * The set of forward keys of a native enum — deliberately excluding the
 * reverse `value -> key` entries TypeScript compiles numeric enums to,
 * because otherwise every numeric enum member would be counted twice. A key
 * is a reverse mapping exactly when its own value maps back to a number.
 */
function nativeEnumValues(values: Record<string, string | number>): string[] {
  const forwardKeys = Object.keys(values).filter(
    (key) => typeof values[values[key] as unknown as string] !== "number",
  );
  return forwardKeys.map((key) => String(values[key])).sort();
}

/**
 * Walks one schema node into its normalised structural summary.
 *
 * `seen` tracks the schemas currently being expanded on this path, not every
 * schema ever visited — a schema reused in two unrelated fields is not a
 * cycle and normalises twice, correctly. Only a schema that reappears while
 * it is still its own ancestor (a recursive `z.lazy` schema referencing
 * itself) is a cycle, and that produces `CYCLE_MARKER` instead of recursing
 * forever.
 */
function normalise(schema: z.ZodTypeAny, seen: Set<z.ZodTypeAny>): string {
  if (seen.has(schema)) return CYCLE_MARKER;
  seen.add(schema);
  try {
    return normaliseNode(schema, seen);
  } finally {
    seen.delete(schema);
  }
}

/**
 * Reads two views of the same `_def`: the raw tag (for the error naming an
 * unhandled type, which the exhaustive `KnownDef` union would otherwise type
 * as unreachable) and the narrowed union the switch below dispatches on.
 * `ZodTypeAny` erases the per-kind discriminant on `_def` down to the base
 * `{ errorMap?, description? }`, so recovering it requires a cast — this is
 * the same technique zod's own schema-introspection tooling uses, and there
 * is no exported type that keeps the discriminant without it.
 */
function normaliseNode(schema: z.ZodTypeAny, seen: Set<z.ZodTypeAny>): string {
  const rawTypeName = String(
    (schema._def as { typeName?: unknown }).typeName ?? "unknown",
  );
  const def = schema._def as unknown as KnownDef;

  switch (def.typeName) {
    case "ZodString":
    case "ZodNumber":
    case "ZodBoolean":
    case "ZodDate":
    case "ZodBigInt":
    case "ZodAny":
    case "ZodUnknown":
    case "ZodNull":
    case "ZodUndefined":
    case "ZodVoid":
      return PRIMITIVE_LABELS[def.typeName];

    case "ZodArray":
      return `array<${normalise(def.type, seen)}>`;

    case "ZodObject": {
      const shape = def.shape();
      const fields = Object.entries(shape)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, fieldSchema]) => `${key}:${normalise(fieldSchema, seen)}`);
      return `object{${fields.join(",")}}`;
    }

    case "ZodOptional":
      return `optional<${normalise(def.innerType, seen)}>`;

    case "ZodNullable":
      return `nullable<${normalise(def.innerType, seen)}>`;

    case "ZodDefault":
      return `default<${normalise(def.innerType, seen)}>`;

    case "ZodRecord":
      return `record<${normalise(def.keyType, seen)},${normalise(def.valueType, seen)}>`;

    case "ZodMap":
      return `map<${normalise(def.keyType, seen)},${normalise(def.valueType, seen)}>`;

    case "ZodSet":
      return `set<${normalise(def.valueType, seen)}>`;

    case "ZodTuple": {
      const items = def.items.map((item) => normalise(item, seen));
      const rest = def.rest ? `,...${normalise(def.rest, seen)}` : "";
      return `tuple[${items.join(",")}${rest}]`;
    }

    case "ZodUnion":
      return `union[${def.options.map((option) => normalise(option, seen)).join(",")}]`;

    case "ZodDiscriminatedUnion":
      return `dunion<${def.discriminator}>[${def.options
        .map((option) => normalise(option, seen))
        .join(",")}]`;

    case "ZodLiteral":
      return `literal<${normaliseLiteralValue(def.value)}>`;

    case "ZodEnum":
      return `enum[${[...def.values].sort().join(",")}]`;

    case "ZodNativeEnum":
      return `nativeEnum[${nativeEnumValues(def.values).join(",")}]`;

    case "ZodLazy":
      return normalise(def.getter(), seen);

    case "ZodEffects":
      return normalise(def.schema, seen);

    case "ZodBranded":
      return `branded<${normalise(def.type, seen)}>`;

    case "ZodReadonly":
      return `readonly<${normalise(def.innerType, seen)}>`;

    default:
      throw new ConfigurationError(
        `deriveStateVersion cannot hash the zod type "${rawTypeName}" — ` +
          "add a case for it in stateVersion.ts before using it in a fold's schema",
        { typeName: rawTypeName },
      );
  }
}

/**
 * FNV-1a over the normalised summary, run twice with different seeds to
 * widen the 32-bit hash to 64 bits before truncating to 12 hex characters.
 * This is a change-detector, not a security boundary — the schemas it
 * distinguishes are a few dozen fold shapes authored by this codebase, not
 * adversarial input — so a small dependency-free hash is the right tool and
 * a `node:crypto` import would buy nothing.
 */
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const SECOND_SEED = 0x9e3779b9;

function fnv1a(value: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

function hashNormalised(normalised: string): string {
  const first = fnv1a(normalised, FNV_OFFSET_BASIS);
  const second = fnv1a(normalised, FNV_OFFSET_BASIS ^ SECOND_SEED);
  const hex = first.toString(16).padStart(8, "0") + second.toString(16).padStart(8, "0");
  return hex.slice(0, 12);
}

/**
 * Hashes a zod schema's normalised shape into a 12-character stamp.
 *
 * This is the value a fold stamps as its state version when it does not pin
 * one explicitly (ADR-105 decision 9). Two schemas that differ only in key
 * order or in a `.describe()` call hash identically; any difference in a
 * field's type, optionality, or nesting changes the hash.
 */
export function deriveStateVersion(schema: z.ZodTypeAny): string {
  return hashNormalised(normalise(schema, new Set()));
}

/**
 * Resolves the version a fold stamps, honouring an explicit pin without
 * letting the pin disable drift detection.
 *
 * A pin decouples the *number* written to rows from the schema hash — it
 * exists so an already-deployed fold can keep its legacy stamp instead of
 * every live row failing its version gate the day derived versions ship
 * (ADR-105 decision 9). But the hash is still computed and returned alongside
 * the pin, because a pin that silently absorbed every future shape change
 * would recreate the exact failure derivation was built to prevent: a stale
 * row decoding into the current shape's meaning.
 */
export function resolveStateVersion(args: {
  schema: z.ZodTypeAny;
  pinned?: string;
}): { version: string; schemaHash: string } {
  const schemaHash = deriveStateVersion(args.schema);
  return { version: args.pinned ?? schemaHash, schemaHash };
}

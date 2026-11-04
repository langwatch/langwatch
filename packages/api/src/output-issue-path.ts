/**
 * The path of an output-schema issue as the log may carry it: array indices and the keys the
 * schema declares, with every other key (a record's, one under `any`) replaced by `<key>`. A
 * declared key is ours; any other is the caller's content.
 */
import { z } from "zod";

const UNDECLARED_KEY = "<key>";

/** Schemas that wrap one inner schema and add no keys of their own. */
const WRAPPERS = [
  z.ZodOptional,
  z.ZodNullable,
  z.ZodDefault,
  z.ZodReadonly,
  z.ZodNonOptional,
  z.ZodPrefault,
  z.ZodCatch,
] as const;

/** The one schema a wrapper or lazy stands for; none for anything else. */
function unwrapped(schema: z.ZodType): z.ZodType | undefined {
  const def: object = schema.def;

  if (WRAPPERS.some((wrapper) => schema instanceof wrapper) && "innerType" in def) {
    return def.innerType as z.ZodType;
  }
  if (schema instanceof z.ZodLazy) return schema.def.getter() as z.ZodType;
  return undefined;
}

/** Where an index leads in one schema. */
function indexIn(schema: z.ZodType, index: number): z.ZodType | undefined {
  if (schema instanceof z.ZodArray) return schema.element as z.ZodType;
  if (!(schema instanceof z.ZodTuple)) return undefined;

  return ((schema.def.items as z.ZodType[])[index] ?? schema.def.rest ?? undefined) as
    | z.ZodType
    | undefined;
}

/** Where a key leads in one schema, and whether the schema names it. */
function keyIn(schema: z.ZodType, key: unknown): { next?: z.ZodType; declared: boolean } {
  if (schema instanceof z.ZodRecord)
    return { next: schema.valueType as z.ZodType, declared: false };
  if (!(schema instanceof z.ZodObject)) return { declared: false };

  const shape = schema.shape as Record<string, z.ZodType>;
  if (typeof key === "string" && Object.hasOwn(shape, key)) {
    return { next: shape[key], declared: true };
  }

  const catchall = schema.def.catchall as z.ZodType | undefined;
  return catchall && !(catchall instanceof z.ZodNever)
    ? { next: catchall, declared: false }
    : { declared: false };
}

/** One segment in one schema: where it leads, whether it can hold it, and whether it names it. */
type Step = { next: z.ZodType[]; holds: boolean; declared: boolean };

/** Where a holder leads that cannot say what it holds: every later segment there is content. */
const OPAQUE: z.ZodType = z.unknown();

/** A schema met again on its own branch: a cycle, read as a holder that names nothing. */
const CYCLE: Step = { next: [OPAQUE], holds: true, declared: false };

/** The segments of each arm or side, and whether they name it, all holders or any. */
function combined(steps: Step[], named: "every" | "some"): Step {
  const holders = steps.filter((each) => each.holds);
  return {
    next: steps.flatMap((each) => each.next),
    holds: holders.length > 0,
    declared: holders.length > 0 && holders[named]((each) => each.declared),
  };
}

/**
 * A declared key or an array/tuple index is named; any other key or number is content. A union
 * names a segment only when every arm that could hold it does; an intersection or a pipe names a
 * key either side declares, but a number only when both index it. See stepWithin for cycles.
 */
function stepIn(schema: z.ZodType, segment: unknown, ancestors: Set<z.ZodType>): Step {
  if (ancestors.has(schema)) return CYCLE;
  ancestors.add(schema);
  try {
    return stepWithin(schema, segment, ancestors);
  } finally {
    ancestors.delete(schema);
  }
}

/** stepIn below its cycle check: `ancestors` holds only this branch, so siblings each count. */
function stepWithin(schema: z.ZodType, segment: unknown, ancestors: Set<z.ZodType>): Step {
  const inner = unwrapped(schema);
  if (inner) return stepIn(inner, segment, ancestors);

  if (schema instanceof z.ZodUnion) {
    const arms = (schema.options as z.ZodType[]).map((arm) => stepIn(arm, segment, ancestors));
    return combined(arms, "every");
  }

  const sides = bothSidesOf(schema);
  if (sides) {
    const both = sides.map((side) => stepIn(side, segment, ancestors));
    return combined(both, typeof segment === "number" ? "every" : "some");
  }

  if (holdsNothing(schema)) return { next: [], holds: false, declared: false };
  if (schema instanceof z.ZodMap) {
    // Zod files a key's own issues under the entry too, so below it may be either schema.
    const entry = [schema.def.keyType as z.ZodType, schema.def.valueType as z.ZodType];
    return { next: entry, holds: true, declared: false };
  }
  const found =
    typeof segment === "number"
      ? { next: indexIn(schema, segment), declared: indexes(schema) }
      : keyIn(schema, segment);
  return { next: [found.next ?? OPAQUE], holds: true, declared: found.declared };
}

/** One segment read through every schema the path may be in: named only if each one names it. */
function step(schemas: z.ZodType[], segment: unknown): { next: z.ZodType[]; declared: boolean } {
  const { next, declared } = combined(
    schemas.map((schema) => stepIn(schema, segment, new Set())),
    "every",
  );
  return { next: [...new Set(next)], declared };
}

/** The two schemas a value must meet at once: an intersection's sides, or a pipe's ends. */
function bothSidesOf(schema: z.ZodType): z.ZodType[] | undefined {
  if (schema instanceof z.ZodIntersection) {
    return [schema.def.left as z.ZodType, schema.def.right as z.ZodType];
  }
  if (schema instanceof z.ZodPipe || schema instanceof z.ZodCodec) {
    return [schema.def.in as z.ZodType, schema.def.out as z.ZodType];
  }
  return undefined;
}

/** A scalar arm: no key or index can lead into it, so it has no say over a segment. */
function holdsNothing(schema: z.ZodType): boolean {
  return (
    schema instanceof z.ZodString ||
    schema instanceof z.ZodNumber ||
    schema instanceof z.ZodBoolean ||
    schema instanceof z.ZodBigInt ||
    schema instanceof z.ZodDate ||
    schema instanceof z.ZodNull ||
    schema instanceof z.ZodUndefined ||
    schema instanceof z.ZodLiteral ||
    schema instanceof z.ZodEnum
  );
}

function indexes(schema: z.ZodType): boolean {
  return schema instanceof z.ZodArray || schema instanceof z.ZodTuple;
}

/** What a path says when reading it through the schema fails: nothing of the caller's. */
const UNREADABLE_PATH = "<redacted>";

/**
 * `[3].params.user`: `path` read through `schema`, each undeclared key as `<key>`. Never throws: a
 * schema that cannot be opened (a lazy getter that throws) gives `<redacted>`, so the issue is
 * still logged.
 */
export function declaredPath(schema: z.ZodType, path: readonly unknown[]): string {
  if (path.length === 0) return "<root>";

  try {
    let schemas: z.ZodType[] = [schema];
    let out = "";

    for (const segment of path) {
      const { next, declared } = step(schemas, segment);
      schemas = next;

      if (typeof segment === "number") {
        out += declared ? `[${segment}]` : `[${UNDECLARED_KEY}]`;
        continue;
      }

      const name = declared && typeof segment === "string" ? segment : UNDECLARED_KEY;
      out += out === "" ? name : `.${name}`;
    }

    return out;
  } catch {
    return UNREADABLE_PATH;
  }
}

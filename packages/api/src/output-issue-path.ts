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

/** The schemas one wrapper, lazy, pipe, union or intersection stands for; none for a leaf. */
function openedBy(schema: z.ZodType): z.ZodType[] | undefined {
  const def: object = schema.def;

  if (WRAPPERS.some((wrapper) => schema instanceof wrapper) && "innerType" in def) {
    return [def.innerType as z.ZodType];
  }
  if (schema instanceof z.ZodLazy) return [schema.def.getter() as z.ZodType];
  if (schema instanceof z.ZodPipe || schema instanceof z.ZodCodec) {
    return [schema.def.in as z.ZodType, schema.def.out as z.ZodType];
  }
  if (schema instanceof z.ZodUnion) return schema.options as z.ZodType[];
  if (schema instanceof z.ZodIntersection) {
    return [schema.def.left as z.ZodType, schema.def.right as z.ZodType];
  }
  return undefined;
}

/** The schemas that decide a segment: every wrapper and combinator opened down to its leaves. */
function concrete(schemas: z.ZodType[]): z.ZodType[] {
  const leaves: z.ZodType[] = [];
  const seen = new Set<z.ZodType>();
  const pending = [...schemas];

  for (let schema = pending.pop(); schema; schema = pending.pop()) {
    if (seen.has(schema)) continue;
    seen.add(schema);

    const opened = openedBy(schema);
    if (opened) pending.push(...opened);
    else leaves.push(schema);
  }

  return leaves;
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

/** Where one segment leads, and whether a schema there names it. */
function step(schemas: z.ZodType[], segment: unknown): { next: z.ZodType[]; declared: boolean } {
  const next: z.ZodType[] = [];
  let declared = false;

  for (const schema of concrete(schemas)) {
    const found =
      typeof segment === "number"
        ? { next: indexIn(schema, segment), declared: false }
        : keyIn(schema, segment);
    if (found.next) next.push(found.next);
    declared ||= found.declared;
  }

  return { next, declared };
}

/** `[3].params.user`: `path` read through `schema`, each undeclared key as `<key>`. */
export function declaredPath(schema: z.ZodType, path: readonly unknown[]): string {
  if (path.length === 0) return "<root>";

  let schemas: z.ZodType[] = [schema];
  let out = "";

  for (const segment of path) {
    const { next, declared } = step(schemas, segment);
    schemas = next;

    if (typeof segment === "number") {
      out += `[${segment}]`;
      continue;
    }

    const name = declared && typeof segment === "string" ? segment : UNDECLARED_KEY;
    out += out === "" ? name : `.${name}`;
  }

  return out;
}

/**
 * The schema compiler. Turns a validated `from` + `select` request into:
 *  - a resolved `schema` (response envelope contract),
 *  - a `plan` the ENGINE executes (which child collections to JOIN, whether to
 *    fetch heavy io columns),
 *  - a per-trace `project` function that shapes each trace to the selection.
 *
 * Pure and synchronous — no DB access — so it is unit-tested in isolation. The
 * ClickHouse/Postgres execution that consumes `plan` lives in the trace service.
 */

import type { Protections } from "~/server/elasticsearch/protections";
import {
  type ProjectionSource,
  type ResolvedField,
  resolveField,
} from "./catalog";
import {
  type CompiledProjection,
  type CompileProjectionArgs,
  type ProjectableTrace,
  type ProjectedRow,
  type ProjectionCollection,
  type ProjectionFrom,
  type ProjectionPlan,
  ProjectionValidationError,
  type ResolvedSchema,
} from "./types";

const COLLECTIONS: ProjectionCollection[] = [
  "events",
  "annotations",
  "evaluations",
];

const COLLECTION_PREFIX: Record<ProjectionCollection, string> = {
  events: "events.",
  annotations: "annotations.",
  evaluations: "evaluations.",
};

export function compileProjection({
  from = "traces",
  select,
  protections,
}: CompileProjectionArgs): CompiledProjection {
  const fields = resolveSelectedFields(select);
  return {
    schema: buildSchema({ from, fields }),
    plan: buildPlan({ from, fields, protections }),
    project: buildProjector({ fields, protections }),
  };
}

/**
 * Resolve every select path against the allowlist, deduped and order-preserving.
 * Throws {@link ProjectionValidationError} listing all unknown paths at once.
 */
function resolveSelectedFields(select: string[]): ResolvedField[] {
  const fields: ResolvedField[] = [];
  const invalidPaths: string[] = [];
  const seen = new Set<string>();
  for (const path of select) {
    if (seen.has(path)) continue;
    seen.add(path);
    const resolved = resolveField(path);
    if (resolved) fields.push(resolved);
    else invalidPaths.push(path);
  }
  if (invalidPaths.length > 0) {
    throw new ProjectionValidationError(invalidPaths);
  }
  return fields;
}

/** The response-envelope schema: one column descriptor per resolved field. */
function buildSchema({
  from,
  fields,
}: {
  from: ProjectionFrom;
  fields: ResolvedField[];
}): ResolvedSchema {
  return {
    from,
    columns: fields.map((f) => ({
      path: f.path,
      type: f.type,
      collection: f.collection !== null,
    })),
  };
}

/** The query plan: which child collections to JOIN and whether to fetch io. */
function buildPlan({
  from,
  fields,
  protections,
}: {
  from: ProjectionFrom;
  fields: ResolvedField[];
  protections: Protections;
}): ProjectionPlan {
  const subPaths = (collection: ProjectionCollection): string[] =>
    fields
      .filter((f) => f.collection === collection)
      .map((f) => f.path.slice(COLLECTION_PREFIX[collection].length));

  return {
    from,
    needsIO: fields.some(
      (f) =>
        (f.protection === "input" || f.protection === "output") &&
        isPermitted(f, protections),
    ),
    needsEvents: fields.some((f) => f.collection === "events"),
    eventPaths: subPaths("events"),
    needsAnnotations: fields.some((f) => f.collection === "annotations"),
    annotationPaths: subPaths("annotations"),
    needsEvaluations: fields.some((f) => f.collection === "evaluations"),
    evaluationPaths: subPaths("evaluations"),
  };
}

/** The per-trace projector: shapes one trace into the requested nested row. */
function buildProjector({
  fields,
  protections,
}: {
  fields: ResolvedField[];
  protections: Protections;
}): (trace: ProjectableTrace) => ProjectedRow {
  const scalarFields = fields.filter((f) => f.collection === null);
  const collectionFields = Object.fromEntries(
    COLLECTIONS.map((c) => [c, fields.filter((f) => f.collection === c)]),
  ) as Record<ProjectionCollection, ResolvedField[]>;

  return (trace: ProjectableTrace): ProjectedRow => {
    const row: ProjectedRow = {};
    const source = trace as unknown as ProjectionSource;

    for (const f of scalarFields) {
      setPath({
        target: row,
        path: f.outPath,
        value: isPermitted(f, protections) ? f.read(source) : null,
      });
    }

    for (const collection of COLLECTIONS) {
      const collFields = collectionFields[collection];
      if (collFields.length === 0) continue;
      row[collection] = collectionElements(trace, collection).map((element) => {
        const projected: ProjectedRow = {};
        for (const f of collFields) {
          setPath({
            target: projected,
            path: f.outPath,
            value: f.read(element),
          });
        }
        return projected;
      });
    }

    return row;
  };
}

function isPermitted(field: ResolvedField, protections: Protections): boolean {
  switch (field.protection) {
    case "input":
      return !!protections.canSeeCapturedInput;
    case "output":
      return !!protections.canSeeCapturedOutput;
    case "costs":
      return !!protections.canSeeCosts;
    default:
      return true;
  }
}

function collectionElements(
  trace: ProjectableTrace,
  collection: ProjectionCollection,
): ProjectionSource[] {
  const raw =
    collection === "events"
      ? trace.events
      : collection === "annotations"
        ? trace.annotations
        : trace.evaluations;
  return (raw ?? []) as unknown as ProjectionSource[];
}

/** Keys that would corrupt the prototype chain if written. */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Place `value` at `path`, creating intermediate objects (e.g. metadata{}).
 * Skips prototype-polluting keys — defense in depth; the catalog already rejects
 * such paths up front, so this never fires in practice.
 */
function setPath({
  target,
  path,
  value,
}: {
  target: ProjectedRow;
  path: string[];
  value: unknown;
}): void {
  let cursor = target;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i] as string;
    if (FORBIDDEN_KEYS.has(key)) return;
    const existing = cursor[key];
    if (typeof existing !== "object" || existing === null) {
      cursor[key] = {};
    }
    cursor = cursor[key] as ProjectedRow;
  }
  const last = path[path.length - 1] as string;
  if (FORBIDDEN_KEYS.has(last)) return;
  cursor[last] = value;
}

/**
 * Projection DSL — public contract for Track 1 of the API Export Traces RFC
 * (EPIC/Q2/api-export). Extends `POST /api/traces/search` with two optional
 * request fields, `from` + `select`, letting a caller declare exactly which
 * columns (and nested child collections) to project — one paginated loop
 * replaces per-trace fan-out.
 *
 * This module is the boundary between the SURFACE (app.v1.ts: request schema,
 * response envelope) and the ENGINE (the schema compiler + the ClickHouse /
 * Postgres plan execution). Both sides depend only on the types here.
 *
 * `from` and `select` are OPTIONAL. Absent → the endpoint behaves exactly as
 * before (backwards compatible).
 */

import { z } from "zod";
import type { Protections } from "~/server/elasticsearch/protections";
import type { Trace } from "~/server/tracer/types";

/**
 * Entity roots the DSL can read `from`. Only "traces" ships in M1; the RFC
 * pre-declares "sessions" / "spans" as future roots so the contract shape
 * does not change when they land.
 */
export const PROJECTION_FROM_ROOTS = ["traces"] as const;
export type ProjectionFrom = (typeof PROJECTION_FROM_ROOTS)[number];
export const projectionFromSchema = z.enum(PROJECTION_FROM_ROOTS);

/**
 * Request-body extension merged into `traceSearchBodySchema` (app.v1.ts).
 * `select` is a FLAT dotted-path list (RFC Technical Plan §1). The server
 * groups paths by root server-side (`metadata.*` → `metadata{}`, `events.*`
 * → `events[]`, …) — the caller never declares the grouping.
 */
export const projectionRequestSchema = z.object({
  from: projectionFromSchema
    .default("traces")
    .describe(
      "Entity root to read from. Only 'traces' is supported today; defaults to 'traces' when omitted.",
    ),
  // Bounded so a caller can't submit unbounded path counts/lengths: the
  // projector loops paths × pageSize per request, so without a cap a single
  // request could pin the event loop (metadata.* accepts arbitrary keys, so
  // the catalog itself doesn't bound cardinality).
  select: z
    .array(z.string().min(1).max(256))
    .min(1)
    .max(200)
    .optional()
    .describe(
      "Flat list of dotted-path columns to project, e.g. ['trace_id','metadata.user_id','events.type','evaluations.score']. " +
        "Paths group by root in the response: scalar fields stay top-level, 'metadata.*' nests under a metadata object, and " +
        "'events.*'/'annotations.*'/'evaluations.*' return as nested arrays (one row per trace). " +
        "When present, the response gains a top-level 'schema' field describing the resolved columns. " +
        "When omitted, the response is unchanged from the legacy shape.",
    ),
});
export type ProjectionRequest = z.infer<typeof projectionRequestSchema>;

/** Scalar value type advertised for a resolved column in the response `schema`. */
export type ProjectionValueType =
  | "string"
  | "number"
  | "boolean"
  | "string[]"
  | "json";

/**
 * One entry in the resolved `schema` envelope field. `collection: true` means
 * the path belongs to a nested child array (events/annotations/evaluations) and
 * `type` describes the element-level value at that sub-path.
 */
export interface ResolvedColumn {
  /** The dotted path exactly as requested, e.g. "metadata.user_id". */
  path: string;
  type: ProjectionValueType;
  /** True when the path resolves into a nested child collection. */
  collection: boolean;
}

/** The `schema` field added to the response envelope when `select` is present. */
export interface ResolvedSchema {
  from: ProjectionFrom;
  columns: ResolvedColumn[];
}

/**
 * Child-collection roots that group into nested arrays in the response. Scalar
 * trace fields (trace_id, timestamps, io, metrics) and `metadata` are not
 * collections.
 */
export type ProjectionCollection = "events" | "annotations" | "evaluations";

/**
 * What the ENGINE must fetch to satisfy a projection. Produced by the compiler,
 * consumed by `getAllTracesForProject` (passed verbatim as `options.projection`)
 * and by the bounded events / Postgres-annotations readers. Opaque to the
 * SURFACE — app.v1.ts just forwards it.
 *
 * The plan is the lever for the perf win: input and output are pruned
 * independently, so an output-only select (the common "grab completions"
 * ETL shape) never materializes the heavy ComputedInput column, and vice
 * versa.
 */
export interface ProjectionPlan {
  from: ProjectionFrom;
  /** Heavy ComputedInput column is needed (selected and permitted). */
  needsInput: boolean;
  /** Heavy ComputedOutput column is needed (selected and permitted). */
  needsOutput: boolean;
  /** Build the nested events[] via a bounded stored_spans sub-query. */
  needsEvents: boolean;
  /** Event sub-paths requested, relative to the `events.` root (e.g. "type", "metrics.vote"). */
  eventPaths: string[];
  /** Build the nested annotations[] via a Postgres (Prisma) read. */
  needsAnnotations: boolean;
  /** Annotation sub-paths requested, relative to the `annotations.` root. */
  annotationPaths: string[];
  /** Include the nested evaluations[] (already enriched on the search path). */
  needsEvaluations: boolean;
  /** Evaluation sub-paths requested, relative to the `evaluations.` root. */
  evaluationPaths: string[];
}

/**
 * An annotation row attached to a trace by the ENGINE before projection.
 * Sourced from Postgres (Prisma `Annotation`) — never present on the legacy
 * read path, so it is carried as an augmentation of `Trace` rather than on the
 * core type.
 */
export interface ProjectedAnnotation {
  id: string;
  is_thumbs_up: boolean | null;
  comment: string | null;
  expected_output: string | null;
  /** Named score values from `scoreOptions`, keyed by score name. */
  scores: Record<string, unknown>;
  created_at: number;
}

/**
 * A trace as seen by the projector: the core `Trace` plus the Postgres-sourced
 * annotations the ENGINE attaches when `needsAnnotations` is set.
 */
export type ProjectableTrace = Trace & {
  annotations?: ProjectedAnnotation[];
};

/** One projected output row (one per trace), shaped to mirror the selection. */
export type ProjectedRow = Record<string, unknown>;

/**
 * The compiler's output. Single object that carries:
 *  - `schema`  → goes into the response envelope when `select` is present.
 *  - `plan`    → forwarded into `getAllTracesForProject` options.projection.
 *  - `project` → applied per-trace in the response serialize loop, replacing
 *                `formatTrace` when a projection is active.
 */
export interface CompiledProjection {
  schema: ResolvedSchema;
  plan: ProjectionPlan;
  project: (trace: ProjectableTrace) => ProjectedRow;
}

/** Arguments to {@link compileProjection}. */
export interface CompileProjectionArgs {
  /** Defaults to "traces" when omitted. */
  from?: ProjectionFrom;
  select: string[];
  /**
   * Caller's data-visibility protections. `input`/`output` paths are pruned
   * (fetched as null, never queried) when the corresponding capture visibility
   * is not granted, mirroring the existing trace read path.
   */
  protections: Protections;
}

/**
 * Thrown by the compiler when `select` contains paths outside the allowlist.
 * The SURFACE maps this to HTTP 400. `invalidPaths` lists every offending path
 * so the caller can fix all of them in one round-trip.
 */
export class ProjectionValidationError extends Error {
  readonly invalidPaths: string[];

  constructor(invalidPaths: string[]) {
    super(`Unknown or unsupported select path(s): ${invalidPaths.join(", ")}`);
    this.name = "ProjectionValidationError";
    this.invalidPaths = invalidPaths;
  }
}

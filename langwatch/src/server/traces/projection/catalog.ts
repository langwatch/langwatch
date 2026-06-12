/**
 * Field catalog — the allowlist of selectable dotted-paths for the projection
 * DSL. This is the public contract: every path a caller may put in `select`
 * resolves here, and anything not here is rejected at compile time (HTTP 400).
 *
 * Mirrors the filter compiler's allowlist discipline: identifiers reaching the
 * query come from this fixed catalog, never from raw caller input.
 *
 * Each path resolves to a {@link ResolvedField} carrying:
 *  - where the value lands in the projected output (`outPath`),
 *  - how to read it off the source (`read`) — the source is the trace for
 *    scalar/grouped fields, or a single child element for collection fields,
 *  - its advertised `type` and, for io/cost, the `protection` that gates it.
 */

import type { ProjectionCollection, ProjectionValueType } from "./types";

/** Visibility gate a field is subject to, mirroring {@link Protections}. */
export type FieldProtection = "input" | "output" | "costs";

export interface ResolvedField {
  /** The dotted path exactly as requested. */
  path: string;
  type: ProjectionValueType;
  /** Child collection this field belongs to, or null for trace-level fields. */
  collection: ProjectionCollection | null;
  /** Visibility gate, or null when the field is always visible. */
  protection: FieldProtection | null;
  /**
   * Where the value is placed in the output. For collection fields the path is
   * relative to the projected element; for trace-level fields it is absolute on
   * the row. Length > 1 means the value nests under an object (e.g.
   * ["metadata","user_id"]).
   */
  outPath: string[];
  /** Reads the value from the source (trace, or child element for collections). */
  read: (src: ProjectionSource) => unknown;
}

/** Loose source shape — a trace or a child element. Reads are defensive (optional chaining). */
export type ProjectionSource = Record<string, unknown> & {
  timestamps?: { started_at?: number | null } | null;
  input?: { value?: string | null } | null;
  output?: { value?: string | null } | null;
  metadata?: Record<string, unknown> | null;
  metrics?: Record<string, unknown> | null;
  event_details?: Record<string, unknown> | null;
  scores?: Record<string, unknown> | null;
};

const PREFIX = {
  metadata: "metadata.",
  metrics: "metrics.",
  evaluations: "evaluations.",
  events: "events.",
  annotations: "annotations.",
} as const;

/** Trace-level scalar fields addressable by their bare name. */
const TRACE_SCALARS: Record<
  string,
  Pick<ResolvedField, "type" | "protection" | "outPath" | "read">
> = {
  trace_id: {
    type: "string",
    protection: null,
    outPath: ["trace_id"],
    read: (t) => t.trace_id ?? null,
  },
  project_id: {
    type: "string",
    protection: null,
    outPath: ["project_id"],
    read: (t) => t.project_id ?? null,
  },
  started_at: {
    type: "number",
    protection: null,
    outPath: ["started_at"],
    read: (t) => t.timestamps?.started_at ?? null,
  },
  inserted_at: {
    type: "number",
    protection: null,
    outPath: ["inserted_at"],
    read: (t) =>
      (t.timestamps as { inserted_at?: number } | null)?.inserted_at ?? null,
  },
  updated_at: {
    type: "number",
    protection: null,
    outPath: ["updated_at"],
    read: (t) =>
      (t.timestamps as { updated_at?: number } | null)?.updated_at ?? null,
  },
  input: {
    type: "string",
    protection: "input",
    outPath: ["input"],
    read: (t) => t.input?.value ?? null,
  },
  output: {
    type: "string",
    protection: "output",
    outPath: ["output"],
    read: (t) => t.output?.value ?? null,
  },
};

/** Trace-level metric keys (`metrics.<key>`). total_cost is cost-gated. */
const TRACE_METRICS: Record<string, ProjectionValueType> = {
  first_token_ms: "number",
  total_time_ms: "number",
  prompt_tokens: "number",
  completion_tokens: "number",
  reasoning_tokens: "number",
  cache_read_input_tokens: "number",
  cache_creation_input_tokens: "number",
  total_cost: "number",
  tokens_estimated: "boolean",
};

/** Evaluation element fields (`evaluations.<key>`), read off each Evaluation. */
const EVALUATION_FIELDS: Record<string, ProjectionValueType> = {
  name: "string",
  score: "number",
  passed: "boolean",
  label: "string",
  details: "string",
  status: "string",
  evaluator_id: "string",
  type: "string",
  is_guardrail: "boolean",
};

/**
 * Annotation element scalar fields (`annotations.<key>`), read off each
 * annotation. `comment` and `expected_output` are free-text fields where
 * reviewers routinely quote the model's captured output, so they share the
 * output-visibility gate — otherwise the projection would be a side-channel
 * around the io redaction.
 */
const ANNOTATION_FIELDS: Record<
  string,
  { type: ProjectionValueType; protection: FieldProtection | null }
> = {
  is_thumbs_up: { type: "boolean", protection: null },
  comment: { type: "string", protection: "output" },
  expected_output: { type: "string", protection: "output" },
  created_at: { type: "number", protection: null },
};

function field(
  partial: Omit<ResolvedField, "path"> & { path: string },
): ResolvedField {
  return partial;
}

/**
 * Path segments that, used as an output object key, would corrupt the prototype
 * chain. metadata.* and the *.metrics / *.details / *.scores sub-paths accept
 * arbitrary segments, so a path like "metadata.__proto__" must be rejected
 * before it ever reaches the projector's setPath.
 */
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Resolve a single dotted-path to its {@link ResolvedField}, or null when the
 * path is not in the allowlist (the caller collects nulls into a 400).
 */
export function resolveField(path: string): ResolvedField | null {
  // Reject prototype-pollution segments anywhere in the path (defense in depth
  // alongside the projector's setPath guard).
  if (path.split(".").some((segment) => FORBIDDEN_SEGMENTS.has(segment))) {
    return null;
  }

  const scalar = TRACE_SCALARS[path];
  if (scalar) return field({ path, collection: null, ...scalar });

  if (path.startsWith(PREFIX.metrics)) {
    const key = path.slice(PREFIX.metrics.length);
    const type = TRACE_METRICS[key];
    if (!type) return null;
    return field({
      path,
      type,
      collection: null,
      protection: key === "total_cost" ? "costs" : null,
      outPath: ["metrics", key],
      read: (t) => t.metrics?.[key] ?? null,
    });
  }

  if (path.startsWith(PREFIX.metadata)) {
    const key = path.slice(PREFIX.metadata.length);
    if (!key) return null;
    return field({
      path,
      type: "json",
      collection: null,
      protection: null,
      outPath: ["metadata", key],
      read: (t) => t.metadata?.[key] ?? null,
    });
  }

  if (path.startsWith(PREFIX.evaluations)) {
    const key = path.slice(PREFIX.evaluations.length);
    const type = EVALUATION_FIELDS[key];
    if (!type) return null;
    return field({
      path,
      type,
      collection: "evaluations",
      protection: null,
      outPath: [key],
      read: (ev) => ev[key] ?? null,
    });
  }

  if (path.startsWith(PREFIX.events)) {
    return resolveEventField({ path, rest: path.slice(PREFIX.events.length) });
  }

  if (path.startsWith(PREFIX.annotations)) {
    return resolveAnnotationField({
      path,
      rest: path.slice(PREFIX.annotations.length),
    });
  }

  return null;
}

function resolveEventField({
  path,
  rest,
}: {
  path: string;
  rest: string;
}): ResolvedField | null {
  if (rest === "type") {
    return field({
      path,
      type: "string",
      collection: "events",
      protection: null,
      outPath: ["type"],
      read: (e) => e.event_type ?? null,
    });
  }
  if (rest === "timestamp") {
    return field({
      path,
      type: "number",
      collection: "events",
      protection: null,
      outPath: ["timestamp"],
      read: (e) => e.timestamps?.started_at ?? null,
    });
  }
  if (rest === "metrics") {
    return field({
      path,
      type: "json",
      collection: "events",
      protection: null,
      outPath: ["metrics"],
      read: (e) => e.metrics ?? {},
    });
  }
  if (rest === "details") {
    return field({
      path,
      type: "json",
      collection: "events",
      protection: null,
      outPath: ["details"],
      read: (e) => e.event_details ?? {},
    });
  }
  if (rest.startsWith("metrics.")) {
    const k = rest.slice("metrics.".length);
    if (!k) return null;
    return field({
      path,
      type: "number",
      collection: "events",
      protection: null,
      outPath: ["metrics", k],
      read: (e) => e.metrics?.[k] ?? null,
    });
  }
  if (rest.startsWith("details.")) {
    const k = rest.slice("details.".length);
    if (!k) return null;
    return field({
      path,
      type: "string",
      collection: "events",
      protection: null,
      outPath: ["details", k],
      read: (e) => e.event_details?.[k] ?? null,
    });
  }
  return null;
}

function resolveAnnotationField({
  path,
  rest,
}: {
  path: string;
  rest: string;
}): ResolvedField | null {
  const scalar = ANNOTATION_FIELDS[rest];
  if (scalar) {
    return field({
      path,
      type: scalar.type,
      collection: "annotations",
      protection: scalar.protection,
      outPath: [rest],
      read: (a) => a[rest] ?? null,
    });
  }
  if (rest === "scores") {
    return field({
      path,
      type: "json",
      collection: "annotations",
      protection: null,
      outPath: ["scores"],
      read: (a) => a.scores ?? {},
    });
  }
  if (rest.startsWith("scores.")) {
    const name = rest.slice("scores.".length);
    if (!name) return null;
    return field({
      path,
      type: "json",
      collection: "annotations",
      protection: null,
      outPath: ["scores", name],
      read: (a) => a.scores?.[name] ?? null,
    });
  }
  return null;
}

/**
 * The trace-search intent, lifted out of a Langy tool call and recompiled for
 * whichever surface the user wants to take it to.
 *
 * When Langy searches traces it does not hand the model a blob of prose — it
 * calls `search_traces` with a STRUCTURED intent: legacy filter fields, an
 * optional free-text term, and a date range (see
 * `mcp-server/src/tools/search-traces.ts`). Today that intent is read once and
 * thrown away; the traces card links to the bare traces index and the user
 * rebuilds the search by hand. This module keeps it, so "show me these in the
 * traces view" can mean the view ALREADY FILTERED to what Langy found.
 *
 * The catch is that the surfaces disagree about how a filter is spelled:
 *
 *   - `search_traces`, the analytics graph builder and the automation drawer
 *     all speak the LEGACY filter record (`Record<FilterField, string[]>`,
 *     `/contracts/filters`), keyed by URL keys from
 *     `src/server/filters/registry.ts`. Those three need no translation at all
 *     — Langy is already speaking their language.
 *   - traces-v2 speaks a Lucene-ish DSL (liqe) carried in the URL FRAGMENT
 *     (`src/features/traces-v2/utils/urlState.ts`). That one needs a compiler.
 *
 * Legacy -> liqe is the tractable direction: legacy is the restricted model (a
 * conjunction of `field IN [values]`), and every legacy field that traces-v2
 * can express maps onto exactly one liqe field. The reverse (liqe -> legacy)
 * is lossy and does not exist anywhere in the codebase.
 *
 * Where a legacy field has NO liqe equivalent we drop it rather than
 * approximate it — a suggestion that quietly widens the user's search is worse
 * than one that admits it carried less across.
 */

/** Time-range preset ids traces-v2 understands (`utils/timeRangePresets.ts`). */
const TIME_PRESETS = ["15m", "1h", "4h", "24h", "7d", "30d", "60d"] as const;
type TimePreset = (typeof TIME_PRESETS)[number];

/**
 * `search_traces` defaults to a 24h window when the model omits the dates
 * (`mcp-server/src/tools/search-traces.ts`), so an intent with no range really
 * did search the last day. Carrying that across keeps the destination honest.
 */
const DEFAULT_PRESET: TimePreset = "24h";

/**
 * A trace search exactly as Langy ran it. `filters` stays in the legacy shape
 * the tool was called with; the MCP schema types it `Record<string, string[]>`,
 * so nested filter values cannot reach us and are ignored defensively.
 */
export interface TraceQueryIntent {
  filters: Record<string, string[]>;
  /** Free-text term, matched against trace input/output. */
  text?: string;
  /** ISO date or a relative shorthand like "24h" / "7d". */
  startDate?: string;
  endDate?: string;
}

/** Legacy filter field -> the liqe field traces-v2 knows it by. */
const LIQE_FIELD_BY_LEGACY: Record<string, string> = {
  "topics.topics": "topic",
  "topics.subtopics": "subtopic",
  "metadata.user_id": "user",
  "metadata.thread_id": "conversation",
  "metadata.customer_id": "customer",
  "metadata.labels": "label",
  "metadata.prompt_ids": "prompt",
  "traces.origin": "origin",
  "traces.name": "traceName",
  "spans.type": "spanType",
  "spans.model": "model",
  "evaluations.evaluator_id": "evaluator",
  "evaluations.state": "evaluatorStatus",
  "evaluations.label": "evaluatorLabel",
  "evaluations.score": "evaluatorScore",
  "events.event_type": "event",
};

/** Legacy filter field -> the URL key the legacy surfaces read it back from. */
const URL_KEY_BY_LEGACY: Record<string, string> = {
  "topics.topics": "topics",
  "topics.subtopics": "subtopics",
  "metadata.user_id": "user_id",
  "metadata.thread_id": "thread_id",
  "metadata.customer_id": "customer_id",
  "metadata.labels": "labels",
  "metadata.key": "metadata_key",
  "metadata.value": "metadata",
  "metadata.prompt_ids": "prompt_id",
  "traces.origin": "origin",
  "traces.error": "has_error",
  "traces.name": "trace_name",
  "spans.type": "span_type",
  "spans.model": "model",
  "evaluations.evaluator_id": "evaluator_id",
  "evaluations.passed": "evaluation_passed",
  "evaluations.score": "evaluation_score",
  "evaluations.label": "evaluation_label",
  "evaluations.state": "evaluation_run",
  "events.event_type": "event_type",
  "annotations.hasAnnotation": "annotations",
};

/** Read a `Record<string, string[]>` entry, tolerating a bare string. */
function valuesOf(raw: unknown): string[] {
  if (typeof raw === "string") return raw.length > 0 ? [raw] : [];
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string" && v.length > 0);
}

/**
 * Pull the search intent out of a `search_traces` tool-call input. Returns null
 * for anything that is not a recognisable trace search, so callers can simply
 * skip suggesting rather than guess.
 */
export function parseTraceQueryIntent(input: unknown): TraceQueryIntent | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;

  const filters: Record<string, string[]> = {};
  if (raw.filters && typeof raw.filters === "object") {
    for (const [field, value] of Object.entries(
      raw.filters as Record<string, unknown>,
    )) {
      const values = valuesOf(value);
      if (values.length > 0) filters[field] = values;
    }
  }

  const text = typeof raw.query === "string" ? raw.query.trim() : "";
  const startDate = typeof raw.startDate === "string" ? raw.startDate : void 0;
  const endDate = typeof raw.endDate === "string" ? raw.endDate : void 0;

  return {
    filters,
    ...(text.length > 0 ? { text } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  };
}

/**
 * An intent with neither a filter nor a term is just "all traces in the
 * window" — there is nothing to carry anywhere, so we suggest nothing.
 */
export function isEmptyIntent(intent: TraceQueryIntent): boolean {
  return Object.keys(intent.filters).length === 0 && !intent.text;
}

/** Quote a liqe value when it is not a bare word the grammar accepts unquoted. */
function liqeValue(value: string): string {
  return /^[A-Za-z0-9._@/:-]+$/.test(value)
    ? value
    : `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** `field:a` for one value, `(field:a OR field:b)` for several. */
function liqeClause(field: string, values: string[]): string {
  const clauses = values.map((v) => `${field}:${liqeValue(v)}`);
  return clauses.length === 1 ? clauses[0]! : `(${clauses.join(" OR ")})`;
}

/**
 * A boolean legacy filter ("true" / "false") that liqe spells as two different
 * clauses rather than a field/value pair. Both values present means the filter
 * constrains nothing, so it compiles to nothing.
 */
function booleanClause(
  values: string[],
  whenTrue: string,
  whenFalse: string,
): string | null {
  const hasTrue = values.includes("true");
  const hasFalse = values.includes("false");
  if (hasTrue && hasFalse) return null;
  if (hasTrue) return whenTrue;
  if (hasFalse) return whenFalse;
  return null;
}

/**
 * Compile the intent into a traces-v2 query string.
 *
 * Only the filters traces-v2 can express survive; the rest are dropped (see the
 * module header). Clauses are ANDed, matching the legacy semantics where every
 * filter field narrows the result set.
 */
export function intentToTraceQuery(intent: TraceQueryIntent): string {
  const clauses: string[] = [];

  for (const [field, values] of Object.entries(intent.filters)) {
    if (values.length === 0) continue;

    if (field === "traces.error") {
      const clause = booleanClause(values, "status:error", "NOT status:error");
      if (clause) clauses.push(clause);
      continue;
    }

    if (field === "annotations.hasAnnotation") {
      const clause = booleanClause(values, "has:annotation", "none:annotation");
      if (clause) clauses.push(clause);
      continue;
    }

    if (field === "evaluations.passed") {
      const clause = booleanClause(
        values,
        "evaluatorVerdict:pass",
        "evaluatorVerdict:fail",
      );
      if (clause) clauses.push(clause);
      continue;
    }

    const liqeField = LIQE_FIELD_BY_LEGACY[field];
    if (!liqeField) continue;
    clauses.push(liqeClause(liqeField, values));
  }

  // A metadata filter is a key/value PAIR in the legacy model; liqe addresses
  // it as one dynamic-namespace field. Only a complete pair is expressible.
  const metadataKeys = intent.filters["metadata.key"] ?? [];
  const metadataValues = intent.filters["metadata.value"] ?? [];
  if (metadataKeys.length === 1 && metadataValues.length > 0) {
    clauses.push(
      liqeClause(`trace.attribute.${metadataKeys[0]!}`, metadataValues),
    );
  }

  // Free text is a bare token in liqe — it matches trace input/output.
  if (intent.text) clauses.push(liqeValue(intent.text));

  return clauses.join(" AND ");
}

/** True when the intent survives the trip to traces-v2 with something on it. */
export function isExpressibleInTraceQuery(intent: TraceQueryIntent): boolean {
  return intentToTraceQuery(intent).length > 0;
}

/**
 * The intent's time range, in whichever form traces-v2 wants it: a preset id
 * when Langy used a relative window (it stays fresh — a preset recomputes
 * against `now` at read time), absolute epoch-ms otherwise.
 */
export function intentToTimeParams(
  intent: TraceQueryIntent,
): { preset: TimePreset } | { from: string; to: string } {
  const { startDate, endDate } = intent;

  if (!startDate) return { preset: DEFAULT_PRESET };

  // A relative window with no explicit end is exactly what a preset means.
  if (!endDate && (TIME_PRESETS as readonly string[]).includes(startDate)) {
    return { preset: startDate as TimePreset };
  }

  const from = Date.parse(startDate);
  const to = endDate ? Date.parse(endDate) : Date.now();
  if (Number.isNaN(from) || Number.isNaN(to)) return { preset: DEFAULT_PRESET };

  return { from: String(from), to: String(to) };
}

/**
 * Deep link into traces-v2 with the search already applied.
 *
 * traces-v2 keeps its whole view state in the URL FRAGMENT, positional lens id
 * first: `#<lensId>?q=…&preset=…`. We always emit the `all-traces` lens rather
 * than a filtered built-in like `errors`, because built-in lenses are
 * user-dismissible and an unknown lens id silently falls back — pinning the
 * filter in `q` is stable regardless of the user's lens state.
 */
export function buildTracesQueryHref({
  projectSlug,
  intent,
}: {
  projectSlug?: string | null;
  intent: TraceQueryIntent;
}): string | null {
  if (!projectSlug) return null;
  const query = intentToTraceQuery(intent);
  if (!query) return null;

  const params = new URLSearchParams();
  params.set("q", query);
  const time = intentToTimeParams(intent);
  if ("preset" in time) params.set("preset", time.preset);
  else {
    params.set("from", time.from);
    params.set("to", time.to);
  }

  return `/${projectSlug}/traces#${encodeURIComponent("all-traces")}?${params.toString()}`;
}

/** Open one trace in the traces-v2 detail drawer. */
export function buildTraceDrawerHref({
  projectSlug,
  traceId,
}: {
  projectSlug?: string | null;
  traceId?: string | null;
}): string | null {
  if (!projectSlug || !traceId) return null;
  const params = new URLSearchParams({
    "drawer.open": "traceV2Details",
    "drawer.traceId": traceId,
  });
  return `/${projectSlug}/traces?${params.toString()}`;
}

/**
 * The intent as legacy URL-key params — the form BOTH the analytics graph
 * builder and the automation drawer already read their filters back from
 * (`src/hooks/useFilterParams.ts`). No translation needed: Langy's filters are
 * natively in this shape, which is why graphing and alerting need no new
 * backend at all.
 */
function legacyFilterParams(intent: TraceQueryIntent): URLSearchParams {
  const params = new URLSearchParams();
  for (const [field, values] of Object.entries(intent.filters)) {
    const urlKey = URL_KEY_BY_LEGACY[field];
    if (!urlKey || values.length === 0) continue;
    // `useFilterParams` parses with qs `arrayFormat: "comma"`.
    params.set(urlKey, values.join(","));
  }
  return params;
}

/** True when at least one filter survives into the legacy URL-key form. */
export function hasLegacyFilters(intent: TraceQueryIntent): boolean {
  return legacyFilterParams(intent).toString().length > 0;
}

/**
 * Open the custom-graph builder with the search applied as the graph's filters.
 * The builder seeds its filters from the URL; the series/metric it leaves at
 * its defaults for the user to shape, which is the point — we hand over the
 * "which traces", they choose the "measure what".
 */
export function buildGraphHref({
  projectSlug,
  intent,
}: {
  projectSlug?: string | null;
  intent: TraceQueryIntent;
}): string | null {
  if (!projectSlug) return null;
  const params = legacyFilterParams(intent);
  if (params.toString().length === 0) return null;
  return `/${projectSlug}/analytics/custom?${params.toString()}`;
}

/**
 * Open the automation drawer with the search applied as the alert's filters.
 *
 * This lands on the legacy traces surface deliberately: traces-v2 stubs its own
 * Automate button out and points back here, because triggers are being rebuilt
 * on the event-driven system and new UI is not to be wired into the legacy
 * `Trigger` shape (`features/traces-v2/components/Toolbar/AutomateButton.tsx`).
 * Navigating with the filters pre-applied respects that boundary — we create no
 * trigger, we just carry the search to where triggers are still authored.
 */
export function buildAlertHref({
  projectSlug,
  intent,
}: {
  projectSlug?: string | null;
  intent: TraceQueryIntent;
}): string | null {
  if (!projectSlug) return null;
  const params = legacyFilterParams(intent);
  if (params.toString().length === 0) return null;
  params.set("drawer.open", "automation");
  return `/${projectSlug}/messages?${params.toString()}`;
}

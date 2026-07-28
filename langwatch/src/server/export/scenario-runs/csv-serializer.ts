/**
 * CSV serialization for scenario run export.
 *
 * Three row axes over the same run record — see ScenarioRunExportMode. Every
 * mode shares the run-level columns built by `buildRunValues`, so a column
 * means the same thing whichever file you opened.
 *
 * Uses PapaParse for RFC 4180-compliant output.
 *
 * @see specs/scenarios/scenario-run-export.feature
 */

import Parse from "papaparse";
import type { ExportableRun } from "~/server/app-layer/simulations/repositories/simulation.repository";
import { categorizeRunStatus } from "~/server/scenarios/scenario-run-category";

/**
 * Run-level columns, shared by all three modes.
 *
 * `status` is the resolved status (the same value the run history shows,
 * including derived STALLED) and `status_category` is its outcome bucket.
 * Both are emitted: the category is what you pivot on, the status is what you
 * need when a single run looks wrong.
 *
 * There is deliberately no pass_rate or any other aggregate — that formula
 * already lives in run-history-transforms.ts and the sidebar ClickHouse query,
 * and a third copy here would drift from the number shown on screen.
 */
const RUN_COLUMNS = [
  "scenario_run_id",
  "scenario_id",
  "scenario_name",
  "batch_run_id",
  "scenario_set_id",
  "status",
  "status_category",
  "verdict",
  "reasoning",
  "error",
  "met_criteria_count",
  "unmet_criteria_count",
  "started_at",
  "duration_ms",
  "total_cost",
  "target_type",
  "target_reference_id",
  "simulation_suite_id",
  "message_count",
  "trace_ids",
] as const;

/** Summary adds the full criteria lists; the other modes carry them per row. */
const SUMMARY_ONLY_COLUMNS = ["met_criteria", "unmet_criteria"] as const;

const CRITERIA_COLUMNS = ["criterion", "met"] as const;

const MESSAGE_COLUMNS = [
  "message_index",
  "message_id",
  "message_role",
  "message_content",
  "message_trace_id",
] as const;

// ---------------------------------------------------------------------------
// Public API — one function per mode
// ---------------------------------------------------------------------------

export function summaryHeaders(): string[] {
  return [...RUN_COLUMNS, ...SUMMARY_ONLY_COLUMNS];
}

export function criteriaHeaders(): string[] {
  return [...RUN_COLUMNS, ...CRITERIA_COLUMNS];
}

export function fullHeaders(): string[] {
  return [...RUN_COLUMNS.map((c) => `run_${c}`), ...MESSAGE_COLUMNS];
}

/** One row per run. */
export function serializeRunsToSummaryCsv({
  runs,
  includeHeader,
}: {
  runs: ExportableRun[];
  includeHeader: boolean;
}): string {
  const rows = runs.map((run) => [
    ...buildRunValues(run),
    jsonArray(run.results?.metCriteria),
    jsonArray(run.results?.unmetCriteria),
  ]);
  return unparse({ headers: summaryHeaders(), rows, includeHeader });
}

/**
 * One row per (run x criterion), so `criterion` becomes a pivotable column and
 * "which criterion fails most often" is a spreadsheet group-by rather than a
 * script. A run judged against no criteria contributes no rows.
 */
export function serializeRunsToCriteriaCsv({
  runs,
  includeHeader,
}: {
  runs: ExportableRun[];
  includeHeader: boolean;
}): string {
  const rows: string[][] = [];
  for (const run of runs) {
    const runValues = buildRunValues(run);
    for (const criterion of run.results?.metCriteria ?? []) {
      rows.push([...runValues, criterion, "true"]);
    }
    for (const criterion of run.results?.unmetCriteria ?? []) {
      rows.push([...runValues, criterion, "false"]);
    }
  }
  return unparse({ headers: criteriaHeaders(), rows, includeHeader });
}

/**
 * One row per message, run fields repeated on each (denormalized) so the flat
 * file stays self-describing. A run with no messages still emits one row with
 * empty message columns, so an errored run never silently vanishes.
 */
export function serializeRunsToFullCsv({
  runs,
  includeHeader,
}: {
  runs: ExportableRun[];
  includeHeader: boolean;
}): string {
  const rows: string[][] = [];
  for (const run of runs) {
    const runValues = buildRunValues(run);
    const messages = run.messages ?? [];
    if (messages.length === 0) {
      rows.push([...runValues, "", "", "", "", ""]);
      continue;
    }
    messages.forEach((message, index) => {
      const m = message as Record<string, unknown>;
      rows.push([
        ...runValues,
        String(index),
        stringOrEmpty(m.id),
        stringOrEmpty(m.role),
        messageContent(m.content),
        stringOrEmpty(m.trace_id),
      ]);
    });
  }
  return unparse({ headers: fullHeaders(), rows, includeHeader });
}

// ---------------------------------------------------------------------------
// Shared row construction
// ---------------------------------------------------------------------------

function buildRunValues(run: ExportableRun): string[] {
  const target = extractTarget(run.metadata);
  const results = run.results;

  return [
    run.scenarioRunId,
    run.scenarioId,
    run.name ?? "",
    run.batchRunId,
    run.scenarioSetId,
    run.status,
    categorizeRunStatus(run.status),
    results?.verdict ?? "",
    results?.reasoning ?? "",
    results?.error ?? "",
    String(results?.metCriteria?.length ?? 0),
    String(results?.unmetCriteria?.length ?? 0),
    isoTimestamp(run.timestamp),
    // For a run still in flight this is elapsed-so-far, not a final duration —
    // the mapper derives it from UpdatedAt when FinishedAt is absent. Read it
    // together with status_category.
    nullableNumber(run.durationInMs),
    nullableNumber(run.totalCost),
    target.targetType,
    target.targetReferenceId,
    target.simulationSuiteId,
    String(run.messages?.length ?? 0),
    jsonArray(collectTraceIds(run)),
  ];
}

/**
 * The langwatch metadata namespace carries which target the run executed
 * against. It is optional — SDK-driven runs may not populate it — so every
 * field degrades to an empty cell rather than throwing.
 */
function extractTarget(metadata: Record<string, unknown> | null | undefined): {
  targetType: string;
  targetReferenceId: string;
  simulationSuiteId: string;
} {
  const langwatch = metadata?.langwatch;
  if (langwatch == null || typeof langwatch !== "object") {
    return { targetType: "", targetReferenceId: "", simulationSuiteId: "" };
  }
  const ns = langwatch as Record<string, unknown>;
  return {
    targetType: stringOrEmpty(ns.targetType),
    targetReferenceId: stringOrEmpty(ns.targetReferenceId),
    simulationSuiteId: stringOrEmpty(ns.simulationSuiteId),
  };
}

/**
 * Trace ids are reachable per message; ScenarioRunData does not carry the
 * run-level TraceIds column, so collect the distinct ones from the messages.
 */
function collectTraceIds(run: ExportableRun): string[] {
  const ids = new Set<string>();
  for (const message of run.messages ?? []) {
    const traceId = (message as Record<string, unknown>).trace_id;
    if (typeof traceId === "string" && traceId !== "") ids.add(traceId);
  }
  return [...ids];
}


// ---------------------------------------------------------------------------
// Value encoding
// ---------------------------------------------------------------------------

/**
 * Criteria and trace ids are JSON arrays, not comma-joined.
 *
 * Criteria are free-text sentences that routinely contain commas, so joining
 * on ", " produces a cell that cannot be split back apart. The *_count columns
 * sit alongside so the common question needs no JSON parsing at all.
 */
function jsonArray(values: string[] | undefined): string {
  if (!values || values.length === 0) return "";
  return JSON.stringify(values);
}

/**
 * ISO-8601 UTC rather than epoch milliseconds: it sorts lexicographically,
 * reads as a date, and spreadsheet software parses it without a formula.
 */
function isoTimestamp(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "";
  return new Date(ms).toISOString();
}

function nullableNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return String(value);
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Message content is a string for plain turns and an array of AG-UI parts when
 * the turn carried structured content (tool calls, externalized media). Parts
 * are JSON-stringified so nothing is silently dropped from a transcript.
 */
function messageContent(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  return JSON.stringify(content);
}

/**
 * RFC 4180 line ending, stated explicitly rather than relying on PapaParse's
 * default.
 *
 * Every chunk must both use this internally AND end with it. A streamed export
 * concatenates chunks directly into one file, so a chunk with no trailing
 * newline glues its last row onto the next chunk's first row, and a chunk that
 * terminates rows with a different sequence than the one PapaParse wrote
 * inside it makes the whole remainder of the file parse as a single row.
 * Neither shows up until an export is large enough to need a second batch.
 */
const NEWLINE = "\r\n";

/**
 * PapaParse writes a header on every call, but a streamed export emits many
 * batches into one file — so only the first batch keeps it.
 */
function unparse({
  headers,
  rows,
  includeHeader,
}: {
  headers: string[];
  rows: string[][];
  includeHeader: boolean;
}): string {
  if (rows.length === 0) {
    return includeHeader
      ? Parse.unparse({ fields: headers, data: [] }, { newline: NEWLINE }) +
          NEWLINE
      : "";
  }
  const csv = Parse.unparse(
    { fields: headers, data: rows },
    { newline: NEWLINE },
  );
  return (includeHeader ? csv : stripHeader(csv)) + NEWLINE;
}

function stripHeader(csv: string): string {
  const firstBreak = csv.indexOf(NEWLINE);
  return firstBreak === -1 ? "" : csv.slice(firstBreak + NEWLINE.length);
}

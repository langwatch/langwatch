/**
 * CSV serialization for scenario run export. Two row axes over the same run record — see
 * ScenarioRunExportMode.
 * @see specs/scenarios/scenario-run-export.feature
 */

import Parse from "papaparse";
import type { SimulationExportRun } from "@langwatch/scenario-contract";
import { categorizeRunStatus } from "@langwatch/scenario-contract";
import { neutralizeFormula } from "@langwatch/csv";

/**
 * The columns a person reads, shortest and highest-signal first so the useful ones fit on screen
 * before the long prose pushes everything sideways.
 */
const CORE_COLUMNS = [
  "scenario_name",
  "status",
  "status_category",
  "verdict",
  "met_criteria_count",
  "unmet_criteria_count",
  "duration_ms",
  "total_cost",
  "started_at",
  "message_count",
  // long prose last within the core block
  "reasoning",
  "error",
  "scenario_description",
] as const;

/**
 * Identifiers and plumbing. Never dropped — they are what lets an export be
 * joined to another export, to traces, or back to the platform — but nobody
 * reads a ksuid, so they sit behind the columns that carry meaning.
 */
const TAIL_COLUMNS = [
  "scenario_run_id",
  "scenario_id",
  "batch_run_id",
  "scenario_set_id",
  "target_type",
  "target_reference_id",
  "simulation_suite_id",
  "parameters",
  "trace_ids",
] as const;

/**
 * The judged criteria, as JSON lists. Carried by full mode, which is where someone reads a failing
 * transcript. "Why did this fail" is only half-answered by the judge's prose `reasoning` — the
 * other half is which specific criteria went unmet, and counts alone cannot say which.
 */
const CRITERIA_LIST_COLUMNS = ["met_criteria", "unmet_criteria"] as const;

const CRITERIA_COLUMNS = ["criterion", "met"] as const;

const MESSAGE_COLUMNS = [
  "message_index",
  "message_role",
  "message_content",
  "message_id",
  "message_trace_id",
] as const;

// ---------------------------------------------------------------------------
// Public API — one function per mode
// ---------------------------------------------------------------------------

export function criteriaHeaders(): string[] {
  return [...CORE_COLUMNS, ...CRITERIA_COLUMNS, ...TAIL_COLUMNS];
}

export function fullHeaders(): string[] {
  return [
    ...CORE_COLUMNS.map((c) => `run_${c}`),
    ...CRITERIA_LIST_COLUMNS.map((c) => `run_${c}`),
    ...MESSAGE_COLUMNS,
    ...TAIL_COLUMNS.map((c) => `run_${c}`),
  ];
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
  runs: SimulationExportRun[];
  includeHeader: boolean;
}): string {
  const rows: string[][] = [];
  for (const run of runs) {
    const core = buildCoreValues(run);
    const tail = buildTailValues(run);
    const push = (criterion: string, met: boolean) =>
      rows.push([...core, text(criterion), String(met), ...tail]);

    for (const criterion of run.results?.metCriteria ?? []) {
      push(criterion, true);
    }
    for (const criterion of run.results?.unmetCriteria ?? []) {
      push(criterion, false);
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
  runs: SimulationExportRun[];
  includeHeader: boolean;
}): string {
  const rows: string[][] = [];
  for (const run of runs) {
    const head = [...buildCoreValues(run), ...buildCriteriaListValues(run)];
    const tail = buildTailValues(run);
    const messages = run.messages ?? [];

    if (messages.length === 0) {
      rows.push([...head, "", "", "", "", "", ...tail]);
      continue;
    }

    messages.forEach((message, index) => {
      const m = message as Record<string, unknown>;
      rows.push([
        ...head,
        String(index),
        text(stringOrEmpty(m.role)),
        text(messageContent(m.content)),
        // Message ids and trace ids are SDK-supplied too, so they get the same
        // treatment as the identifiers in the tail block.
        text(stringOrEmpty(m.id)),
        text(stringOrEmpty(m.trace_id)),
        ...tail,
      ]);
    });
  }

  return unparse({ headers: fullHeaders(), rows, includeHeader });
}

// ---------------------------------------------------------------------------
// Shared row construction — one builder per column group, in header order
// ---------------------------------------------------------------------------

function buildCoreValues(run: SimulationExportRun): string[] {
  const results = run.results;

  return [
    text(run.name ?? ""),
    run.status,
    categorizeRunStatus(run.status),
    results?.verdict ?? "",
    String(results?.metCriteria?.length ?? 0),
    String(results?.unmetCriteria?.length ?? 0),
    // For a run still in flight this is elapsed-so-far, not a final duration —
    // the mapper derives it from UpdatedAt when FinishedAt is absent. Read it
    // together with status_category.
    nullableNumber(run.durationInMs),
    nullableNumber(run.totalCost),
    isoTimestamp(run.timestamp),
    String(run.messages?.length ?? 0),
    text(results?.reasoning ?? ""),
    text(results?.error ?? ""),
    text(run.description ?? ""),
  ];
}

function buildCriteriaListValues(run: SimulationExportRun): string[] {
  return [jsonArray(run.results?.metCriteria), jsonArray(run.results?.unmetCriteria)];
}

/**
 * Identifiers go through `text()` like any prose field. They read as machine-generated and safe,
 * but only some of them are: a set id, scenario id, batch id and target reference all arrive from
 * the SDK as arbitrary strings, so `=cmd|…` is a value a caller can choose.
 */
function buildTailValues(run: SimulationExportRun): string[] {
  const target = extractTarget(run.metadata);

  return [
    text(run.scenarioRunId),
    text(run.scenarioId),
    text(run.batchRunId),
    text(run.scenarioSetId),
    text(target.targetType),
    text(target.targetReferenceId),
    text(target.simulationSuiteId),
    extractParameters(run.metadata),
    jsonArray(collectTraceIds(run)),
  ];
}

/**
 * The parameter values the run resolved, as one JSON object.
 */
function extractParameters(metadata: Record<string, unknown> | null | undefined): string {
  const parameters = metadata?.parameters;
  if (parameters == null || typeof parameters !== "object") {
    return "";
  }
  if (Array.isArray(parameters)) {
    return "";
  }
  if (Object.keys(parameters).length === 0) {
    return "";
  }
  return text(JSON.stringify(parameters));
}

/**
 * The langwatch metadata namespace carries which target the run executed
 * against. It is optional — SDK- and CLI-driven runs do not populate it — so
 * every field degrades to an empty cell rather than throwing.
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
 * Union of the run-level TraceIds column and the per-message trace ids.
 */
function collectTraceIds(run: SimulationExportRun): string[] {
  const ids = new Set<string>();
  for (const traceId of run.traceIds ?? []) {
    if (traceId !== "") {
      ids.add(traceId);
    }
  }

  for (const message of run.messages ?? []) {
    const traceId = (message as Record<string, unknown>).trace_id;
    if (typeof traceId === "string" && traceId !== "") {
      ids.add(traceId);
    }
  }

  return [...ids];
}

// ---------------------------------------------------------------------------
// Value encoding
// ---------------------------------------------------------------------------

/**
 * Criteria and trace ids are JSON arrays, not comma-joined. Criteria are free-text sentences that
 * routinely contain commas, so joining on ", " produces a cell that cannot be split back apart. The
 * *_count columns sit alongside so the common question needs no JSON parsing at all.
 */
function jsonArray(values: string[] | undefined): string {
  if (!values || values.length === 0) {
    return "";
  }
  return text(JSON.stringify(values));
}

/**
 * ISO-8601 UTC rather than epoch milliseconds: it sorts lexicographically,
 * reads as a date, and spreadsheet software parses it without a formula.
 */
function isoTimestamp(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) {
    return "";
  }
  return new Date(ms).toISOString();
}

function nullableNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "";
  }
  return String(value);
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Neutralize a free-text cell against spreadsheet formula injection. Scenario names, judge
 * reasoning, criteria and message content are all user- or model-controlled, and the entire point
 * of this file is to be opened in a spreadsheet, so every free-text cell goes through the guard.
 */
function text(value: string): string {
  return neutralizeFormula(value);
}

/**
 * Message content is a string for plain turns and an array of AG-UI parts when
 * the turn carried structured content (tool calls, externalized media). Parts
 * are JSON-stringified so nothing is silently dropped from a transcript.
 */
function messageContent(content: unknown): string {
  if (content == null) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  return JSON.stringify(content);
}

/**
 * RFC 4180 line ending, stated explicitly rather than relying on PapaParse's default. Every chunk
 * must both use this internally AND end with it.
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
      ? Parse.unparse({ fields: headers, data: [] }, { newline: NEWLINE }) + NEWLINE
      : "";
  }

  const csv = Parse.unparse({ fields: headers, data: rows }, { newline: NEWLINE });

  return (includeHeader ? csv : stripHeader(csv)) + NEWLINE;
}

function stripHeader(csv: string): string {
  const firstBreak = csv.indexOf(NEWLINE);

  return firstBreak === -1 ? "" : csv.slice(firstBreak + NEWLINE.length);
}

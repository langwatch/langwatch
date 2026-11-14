/**
 * The trace_evaluation_analytics rows a trace analytics state stands for, their digest, and the
 * collapsing writes that move ClickHouse's live rows to them (trace ADR-003).
 * @see specs/trace/trace-evaluation-analytics.feature
 */
import { createHash } from "node:crypto";

import {
  EVALUATION_OUTCOME_OCCURRED_AT_MAX_MS,
  EVALUATION_OUTCOME_TEXT_MAX_LENGTH,
  type EvaluationOutcomeRecordedEventData,
  type RecordEvaluationOutcomeCommandData,
} from "@langwatch/trace-contract";

import type { TraceAnalyticsMetadataColumns } from "./trace-widget-columns.rules.ts";

/** The replay step that writes the evaluation rows of the traces the stock widgets read. */
export const TRACE_EVALUATION_ANALYTICS_REPLAY_STEP_ID = "trace:replay-trace-evaluation-analytics";

/** The step that records each recent evaluation's outcome on its trace before that replay. */
export const RECORD_EVALUATION_OUTCOMES_STEP_ID = "trace:record-evaluation-outcomes";

/** How far the live-row read reaches below the earliest trace: an evaluation follows its trace. */
export const LIVE_ROW_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/**
 * How long after an evaluation its trace may still arrive: a younger evaluation of a trace not
 * stored yet is retried, an older one skipped. The queue's 25 attempts span over two hours.
 */
export const EVALUATED_TRACE_WAIT_MS = 60 * 60 * 1000;

/** Evaluator clocks may run ahead of ours; a time further ahead is a bad or hostile clock. */
export const EVALUATION_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * The most evaluations one trace's fold state keeps, so a hostile run cannot grow it unbounded.
 * Past it a new evaluation is refused, never an earlier one dropped, so no written row strands.
 */
export const EVALUATIONS_PER_TRACE_MAX = 200;

const TRUNCATION_ELLIPSIS = "\u2026";

/** The trace_analytics row columns an evaluation row copies, as the fold wrote them. */
export interface TraceRowColumns {
  tenantId: string;
  traceId: string;
  occurredAtMs: number;
  origin: string;
  customerId: string | null;
  topicId: string | null;
  labels: readonly string[];
  metadataColumns?: TraceAnalyticsMetadataColumns;
}

/** One evaluation's outcome as the fold keeps it, keyed by evaluation id. */
export type EvaluationOutcomes = Readonly<
  Record<string, Omit<EvaluationOutcomeRecordedEventData, "evaluationId">>
>;

/** One evaluation's row content: every column but UpdatedAt, Sign, Revision and retention. */
export interface TraceEvaluationAnalyticsRow {
  tenantId: string;
  traceId: string;
  evaluationId: string;
  /** The evaluation's time, as evaluation_analytics has it. */
  occurredAtMs: number;
  /** The trace's OccurredAt, exactly trace_analytics' column. */
  traceOccurredAtMs: number;
  evaluatorName: string | null;
  status: string;
  isGuardrail: boolean;
  passed: boolean | null;
  label: string | null;
  /** The evaluation's origin: null, as evaluation_analytics writes it today. */
  origin: string | null;
  /** trace_analytics.Origin. */
  traceOrigin: string | null;
  customerId: string | null;
  topicId: string | null;
  labels: string[];
  metadataTopic: string;
  metadataDocumentType: string;
  metadataLanguage: string;
  metadataTeam: string;
  metadataFlow: string;
  metadataSegment: string;
  metadataPromptVersion: string;
}

/** A row as ClickHouse holds it live: its content plus the columns a retraction must repeat. */
export interface LiveTraceEvaluationAnalyticsRow {
  row: TraceEvaluationAnalyticsRow;
  updatedAtMs: number;
  revision: number;
  retentionDays: number;
  /** The group's sum(Sign), never 0: only its sign is read, as replica lag can skew its size. */
  signSum: number;
}

/** One insert into the collapsing table: a retraction (-1) or a state (+1). */
export interface TraceEvaluationAnalyticsWrite {
  row: TraceEvaluationAnalyticsRow;
  sign: 1 | -1;
  revision: number;
  updatedAtMs: number;
  retentionDays: number;
}

/**
 * A total order on (evaluationOccurredAt, sourceEventId), so a replay and the live fold keep
 * the same outcome whatever order redelivery brings; the id only breaks a tie.
 */
export function isFresherOutcome({
  outcome,
  than,
}: {
  outcome: Pick<EvaluationOutcomeRecordedEventData, "evaluationOccurredAt" | "sourceEventId">;
  than: Pick<EvaluationOutcomeRecordedEventData, "evaluationOccurredAt" | "sourceEventId">;
}): boolean {
  if (outcome.evaluationOccurredAt !== than.evaluationOccurredAt) {
    return outcome.evaluationOccurredAt > than.evaluationOccurredAt;
  }
  return outcome.sourceEventId > than.sourceEventId;
}

/** Whether the fold may keep an outcome: its evaluation is held, or there is room for one more. */
export function keepsEvaluation({
  evaluations,
  evaluationId,
}: {
  evaluations: EvaluationOutcomes | undefined;
  evaluationId: string;
}): boolean {
  if (!evaluations || evaluationId in evaluations) return true;
  return Object.keys(evaluations).length < EVALUATIONS_PER_TRACE_MAX;
}

/**
 * The command within the bounds the read and the schema assume: evaluation time no earlier than
 * the live-row lookback below its trace (that bound wins) nor past now plus clock skew, and the
 * evaluator name and label truncated to the contract's maximum.
 */
export function boundedOutcomeCommand({
  command,
  nowMs,
}: {
  command: RecordEvaluationOutcomeCommandData;
  nowMs: number;
}): RecordEvaluationOutcomeCommandData {
  const earliest = Math.max(0, command.occurredAt - LIVE_ROW_LOOKBACK_MS);
  const latest = Math.min(nowMs + EVALUATION_CLOCK_SKEW_MS, EVALUATION_OUTCOME_OCCURRED_AT_MAX_MS);
  return {
    ...command,
    evaluatorName: command.evaluatorName === null ? null : truncatedText(command.evaluatorName),
    label: command.label === null ? null : truncatedText(command.label),
    evaluationOccurredAt: Math.max(earliest, Math.min(command.evaluationOccurredAt, latest)),
  };
}

function truncatedText(value: string): string {
  if (value.length <= EVALUATION_OUTCOME_TEXT_MAX_LENGTH) return value;
  return value.slice(0, EVALUATION_OUTCOME_TEXT_MAX_LENGTH - 1) + TRUNCATION_ELLIPSIS;
}

/** One row per evaluation, its trace columns copied from the trace_analytics row written. */
export function traceEvaluationRowsOf({
  state,
  traceRow,
}: {
  state: { evaluations?: EvaluationOutcomes };
  traceRow: TraceRowColumns;
}): TraceEvaluationAnalyticsRow[] {
  const metadata = traceRow.metadataColumns;
  const evaluations = state.evaluations ?? {};
  return Object.keys(evaluations)
    .toSorted()
    .flatMap((evaluationId) => {
      const outcome = evaluations[evaluationId];
      return outcome ? [{ evaluationId, outcome }] : [];
    })
    .map(({ evaluationId, outcome }) => ({
      tenantId: traceRow.tenantId,
      traceId: traceRow.traceId,
      evaluationId,
      occurredAtMs: outcome.evaluationOccurredAt,
      traceOccurredAtMs: traceRow.occurredAtMs,
      evaluatorName: outcome.evaluatorName,
      status: outcome.status,
      isGuardrail: outcome.isGuardrail,
      passed: outcome.passed,
      label: outcome.label,
      origin: null,
      traceOrigin: traceRow.origin,
      customerId: traceRow.customerId,
      topicId: traceRow.topicId,
      labels: [...traceRow.labels],
      metadataTopic: metadata?.MetadataTopic ?? "",
      metadataDocumentType: metadata?.MetadataDocumentType ?? "",
      metadataLanguage: metadata?.MetadataLanguage ?? "",
      metadataTeam: metadata?.MetadataTeam ?? "",
      metadataFlow: metadata?.MetadataFlow ?? "",
      metadataSegment: metadata?.MetadataSegment ?? "",
      metadataPromptVersion: metadata?.MetadataPromptVersion ?? "",
    }));
}

/** The digest of a trace's rows, '' for none; equal rows always digest the same. */
export function traceEvaluationRowsDigest(rows: readonly TraceEvaluationAnalyticsRow[]): string {
  if (rows.length === 0) return "";
  const canonical = rows.map(canonicalContentOf).toSorted();
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/**
 * The inserts that move the live rows to `wanted`: nothing for an unchanged row, one retraction
 * per other live group plus the next revision for a changed one, revision 1 for a new one. A
 * lagging replica skews a group's sign sum, so no write is sized by it (trace ADR-003).
 */
export function traceEvaluationRowWrites({
  wanted,
  live,
  updatedAtMs,
  retentionDays,
}: {
  wanted: readonly TraceEvaluationAnalyticsRow[];
  live: readonly LiveTraceEvaluationAnalyticsRow[];
  updatedAtMs: number;
  retentionDays: number;
}): TraceEvaluationAnalyticsWrite[] {
  const liveByKey = new Map<string, LiveTraceEvaluationAnalyticsRow[]>();
  for (const entry of live) {
    const key = rowKeyOf(entry.row);
    liveByKey.set(key, [...(liveByKey.get(key) ?? []), entry]);
  }
  return wanted.flatMap((row) => {
    const current = liveByKey.get(rowKeyOf(row)) ?? [];
    const content = canonicalContentOf(row);
    const positive = current.filter((entry) => entry.signSum > 0);
    const unchanged = positive.find((entry) => canonicalContentOf(entry.row) === content);
    const retractions = positive
      .filter((entry) => entry !== unchanged)
      .map((entry) => retractionOf(entry));
    if (unchanged) return retractions;
    // A negative group's revision still counts: the engine collapses by key and revision.
    const revision = Math.max(0, ...current.map((entry) => entry.revision)) + 1;
    return [...retractions, { row, sign: 1 as const, revision, updatedAtMs, retentionDays }];
  });
}

/** The live row written again at -1, byte for byte, so it cancels the one +1 the fold wrote. */
function retractionOf(entry: LiveTraceEvaluationAnalyticsRow): TraceEvaluationAnalyticsWrite {
  const { row, revision, updatedAtMs, retentionDays } = entry;
  return { row, sign: -1, revision, updatedAtMs, retentionDays };
}

function rowKeyOf(
  row: Pick<TraceEvaluationAnalyticsRow, "tenantId" | "traceId" | "evaluationId">,
): string {
  return JSON.stringify([row.tenantId, row.traceId, row.evaluationId]);
}

/** Every content column in a fixed order, so key order in the object never moves the digest. */
function canonicalContentOf(row: TraceEvaluationAnalyticsRow): string {
  return JSON.stringify([
    row.tenantId,
    row.traceId,
    row.evaluationId,
    row.occurredAtMs,
    row.traceOccurredAtMs,
    row.evaluatorName,
    row.status,
    row.isGuardrail,
    row.passed,
    row.label,
    row.origin,
    row.traceOrigin,
    row.customerId,
    row.topicId,
    row.labels,
    row.metadataTopic,
    row.metadataDocumentType,
    row.metadataLanguage,
    row.metadataTeam,
    row.metadataFlow,
    row.metadataSegment,
    row.metadataPromptVersion,
  ]);
}

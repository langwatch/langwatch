/**
 * One widget's state, from what each of its queries answered: the face the frame draws and the
 * notes the card's (i) carries. The rules: features/dashboards/WIDGET_STANDARD.md.
 */

import type { QueryCompleteness, QueryCompletenessState } from "@langwatch/analytics-contract";
import {
  CHART_QUERY_MAX_RETRIES,
  type ChartQueryError,
} from "@langwatch/analytics-contract/chart-frame-protocol";

/** What one query has answered since the frame (re)started. */
export interface WidgetQueryRecord {
  /** The latest result's report; null when that result carried none. */
  readonly completeness: QueryCompleteness | null;
  readonly hasResult: boolean;
  /** Failures since the last result, and the latest of them. */
  readonly failure?: { readonly error: ChartQueryError; readonly attempts: number };
}

/** Each query's record, by query name. */
export type WidgetQueryRecords = Readonly<Record<string, WidgetQueryRecord>>;

const UNANSWERED: WidgetQueryRecord = { completeness: null, hasResult: false };

/** A result replaces the query's report and clears its failures. */
export function recordQueryResult({
  records,
  queryName,
  completeness,
}: {
  records: WidgetQueryRecords;
  queryName: string;
  completeness: QueryCompleteness | undefined;
}): WidgetQueryRecords {
  return { ...records, [queryName]: { completeness: completeness ?? null, hasResult: true } };
}

/** A failure keeps the query's last report, so a failed refresh still draws the rows it had. */
export function recordQueryFailure({
  records,
  queryName,
  error,
}: {
  records: WidgetQueryRecords;
  queryName: string;
  error: ChartQueryError;
}): WidgetQueryRecords {
  const record = records[queryName] ?? UNANSWERED;
  const attempts = (record.failure?.attempts ?? 0) + 1;
  return { ...records, [queryName]: { ...record, failure: { error, attempts } } };
}

/** What all of a widget's queries together say about their data. */
export interface WidgetCompleteness {
  /** The worst state over the queries that saw traffic; no_traffic only when none did. */
  readonly state: QueryCompletenessState;
  /** Each query's report, in the order the queries first answered. */
  readonly reports: readonly QueryCompleteness[];
}

const STATE_RANK: Readonly<Record<QueryCompletenessState, number>> = {
  complete: 0,
  partial: 1,
  missing: 2,
  no_traffic: 0,
};

/** Null when no query reported, such as a widget whose queries ignore the board's period. */
export function combineCompleteness(
  reports: readonly QueryCompleteness[],
): WidgetCompleteness | null {
  if (reports.length === 0) return null;
  // A query over another window (last week, for a comparison) may be empty while this one is not.
  const withTraffic = reports.filter((report) => report.state !== "no_traffic");
  if (withTraffic.length === 0) return { state: "no_traffic", reports };
  const state = withTraffic
    .map((report) => report.state)
    .reduce((worst, next) => (STATE_RANK[next] > STATE_RANK[worst] ? next : worst));
  return { state, reports };
}

/** What the frame draws in place of the widget's own code, or the code itself. */
export type WidgetFace =
  | { readonly kind: "chart"; readonly completeness: WidgetCompleteness | null }
  | { readonly kind: "failed"; readonly error: ChartQueryError }
  | { readonly kind: "no_traffic"; readonly unit: string }
  | {
      readonly kind: "missing";
      readonly missing: { field: string; label: string };
      /** What the query counts, "traces" or "evaluations", for the setup view's words. */
      readonly unit: string;
    };

/** A failure counts once the frame has stopped retrying it. */
function isFinal(failure: NonNullable<WidgetQueryRecord["failure"]>): boolean {
  return failure.error.retryable !== true || failure.attempts > CHART_QUERY_MAX_RETRIES;
}

/**
 * The widget's face. A query that failed for good before it ever answered fails the widget; one
 * whose refresh failed keeps its rows. Then the combined report decides.
 */
export function widgetFace(records: WidgetQueryRecords): WidgetFace {
  const all = Object.values(records);
  const failed = all.find(
    (record) => !record.hasResult && record.failure !== undefined && isFinal(record.failure),
  );
  if (failed?.failure) return { kind: "failed", error: failed.failure.error };

  const completeness = combineCompleteness(
    all.flatMap((record) => (record.completeness ? [record.completeness] : [])),
  );
  // A query with no report (outside the period, such as "has this source ever sent anything")
  // gives the widget something of its own to say, so it is not emptied.
  const allReported = all.every((record) => !record.hasResult || record.completeness !== null);
  if (completeness?.state === "no_traffic" && allReported) {
    return { kind: "no_traffic", unit: completeness.reports[0]?.unit ?? "traces" };
  }
  const missing = missingFace(completeness);
  return missing ?? { kind: "chart", completeness };
}

/** The setup view for the first field no row carries, when a query found one. */
function missingFace(completeness: WidgetCompleteness | null): WidgetFace | undefined {
  if (completeness?.state !== "missing") return undefined;
  const report = completeness.reports.find((candidate) => candidate.state === "missing");
  const field = report?.fields.find((candidate) => candidate.present === 0);
  if (!report || !field) return undefined;
  return {
    kind: "missing",
    missing: { field: field.field, label: field.label },
    unit: report.unit,
  };
}

const count = (n: number) => n.toLocaleString("en-US");
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "Total cost on 400 of 1,000 traces." for each field some rows lack. */
function fieldNotes(report: QueryCompleteness): string[] {
  const of = `of ${count(report.total)} ${report.unit}.`;
  return report.fields
    .filter((field) => field.present < report.total)
    .map((field) => `${sentence(field.label)} on ${count(field.present)} ${of}`);
}

/** "No price for my-finetune-v2 (600 traces).", when some traces have no price. */
function unpricedNotes(report: QueryCompleteness): string[] {
  if (!report.unpriced || report.unpriced.count === 0) return [];
  const traces = `${count(report.unpriced.count)} ${report.unit}`;
  return [`No price for ${report.unpriced.models.join(", ")} (${traces}).`];
}

/** The (i)'s lines for partial data, empty otherwise. */
export function completenessNotes(completeness: WidgetCompleteness | null): string[] {
  if (completeness?.state !== "partial") return [];
  const lines = completeness.reports.flatMap((report) => [
    ...fieldNotes(report),
    ...unpricedNotes(report),
  ]);
  return [...new Set(lines)];
}

/**
 * "Checked 1,000 traces in this period.": the sample under a widget whose data is whole, so the
 * (i) carries it and the card face never does. Partial data says its own totals.
 */
export function sampleNote(completeness: WidgetCompleteness | null): string | undefined {
  if (completeness?.state !== "complete") return undefined;
  const report = completeness.reports.find((candidate) => candidate.total > 0);
  return report ? `Checked ${count(report.total)} ${report.unit} in this period.` : undefined;
}

/** Whether any query found traces whose model has no price, so the (i) offers to add one. */
export function hasUnpricedCost(completeness: WidgetCompleteness | null): boolean {
  return completeness?.reports.some((report) => (report.unpriced?.count ?? 0) > 0) ?? false;
}

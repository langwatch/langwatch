/**
 * The words the automation view puts on one recorded evaluation.
 *
 * Pure and framework-free so the copy can be pinned by a test without
 * rendering anything. Two rules run through it: say what happened in the
 * reader's terms ("did not fire", not "not_breached"), and never quote an
 * internal detail — a verdict or skip code the product has not seen before
 * degrades to a plain, honest sentence instead of leaking its own vocabulary.
 */

import { OPERATOR_LABELS } from "~/features/automations/logic/draftReducer";
import type { GraphAlertOperator } from "~/server/app-layer/automations/graph-alert.builder";

/** The recorded evaluation as the drawer receives it over the wire, where
 *  dates arrive as strings or Dates depending on the transformer. */
export interface RecordedEvaluation {
  evaluatedAt: string | Date;
  verdict: string;
  observedValue: number | null;
  threshold: number | null;
  operator: string | null;
  timePeriodMinutes: number | null;
  skipCode: string | null;
}

export interface EvaluationPresentation {
  /** What the check decided, in one short phrase. */
  outcome: string;
  /** What it observed against what it was looking for. Null when the check
   *  never got as far as reading the metric. */
  observation: string | null;
  /** Why a skipped check was skipped, and what to do about it. Null unless
   *  the check was skipped. */
  explanation: string | null;
  /** Whether this evaluation is one the reader should act on. */
  tone: "fired" | "quiet" | "attention";
}

const OUTCOME: Record<
  string,
  { text: string; tone: EvaluationPresentation["tone"] }
> = {
  fired: { text: "The automation fired", tone: "fired" },
  already_firing: { text: "The automation was already firing", tone: "fired" },
  resolved: { text: "The metric recovered", tone: "quiet" },
  not_breached: { text: "The automation did not fire", tone: "quiet" },
  not_delivered: {
    text: "The automation could not reach its destination",
    tone: "attention",
  },
  skipped: { text: "The check was skipped", tone: "attention" },
};

/**
 * Customer copy for each skip. Every sentence names the thing the reader can
 * change — a skip the reader cannot act on is worse than no explanation,
 * because it reads as a platform fault they have to wait out.
 */
const SKIP_EXPLANATION: Record<string, string> = {
  subject_missing:
    "The graph this automation watches no longer exists. Edit the automation and choose a graph that does.",
  incomplete_configuration:
    "This automation is missing part of its condition. Edit it and set the metric, the comparison, and the threshold.",
  result_too_large:
    "The graph this automation watches groups by a field with too many distinct values to check against a threshold. Edit the graph to group by fewer values, or remove the grouping.",
  series_percentage_unsupported:
    "The series this automation watches cannot be shown as a percentage. Edit the graph and turn off the percentage option for this series, or watch a different series.",
  inactive: "This automation is paused, so nothing is being checked.",
};

export function describeEvaluation(
  evaluation: RecordedEvaluation,
): EvaluationPresentation {
  const outcome = OUTCOME[evaluation.verdict];
  return {
    outcome: outcome?.text ?? "The automation was checked",
    observation: describeObservation(evaluation),
    explanation:
      evaluation.verdict === "skipped"
        ? (SKIP_EXPLANATION[evaluation.skipCode ?? ""] ??
          "This check could not run as the automation is configured. Edit the automation and check its graph, metric, and threshold.")
        : null,
    tone: outcome?.tone ?? "quiet",
  };
}

/** "observed 42, threshold is greater than 100 over 1 hour" — the two numbers
 *  the reader came for, in the order they think about them. */
function describeObservation({
  observedValue,
  threshold,
  operator,
  timePeriodMinutes,
}: RecordedEvaluation): string | null {
  if (observedValue === null) return null;
  const observed = `observed ${formatMetricValue(observedValue)}`;
  if (threshold === null) return observed;
  const comparison = operator
    ? (OPERATOR_LABELS[operator as GraphAlertOperator] ?? "past")
    : "past";
  const window = timePeriodMinutes
    ? ` over ${formatWindow(timePeriodMinutes)}`
    : "";
  return `${observed}, fires when ${comparison} ${formatMetricValue(threshold)}${window}`;
}

/** Metrics are rarely integers (a p95 latency, a cost, a rate). Two decimals
 *  is enough to distinguish values without turning the line into noise, and a
 *  whole number keeps its whole-number shape. */
export function formatMetricValue(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return Number.isInteger(value)
    ? value.toLocaleString()
    : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Spelled out, never abbreviated: "1 hour", not "1h". */
export function formatWindow(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  if (minutes < 1440) {
    const hours = minutes / 60;
    return `${formatMetricValue(hours)} ${hours === 1 ? "hour" : "hours"}`;
  }
  const days = minutes / 1440;
  return `${formatMetricValue(days)} ${days === 1 ? "day" : "days"}`;
}

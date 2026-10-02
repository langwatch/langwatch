/**
 * The words the automation view puts on one recorded evaluation. Pure, so the
 * copy is pinned by a test. Say what happened in the reader's terms, and never
 * quote an internal code: an unknown verdict or skip degrades to plain copy.
 */

import type { WireOf } from "@langwatch/api/web";
import type { GraphAlertOperator, TriggerLatestEvaluation } from "@langwatch/automation-contract";

import { OPERATOR_LABELS } from "./draft-reducer.ts";

/** One recorded evaluation as the drawer receives it (dates as ISO strings). */
export type RecordedEvaluation = Omit<WireOf<TriggerLatestEvaluation>, "triggerId" | "projectId">;

export interface EvaluationPresentation {
  /** What the check decided, in one short phrase. */
  outcome: string;
  /** What it observed against what it looked for; empty when it never read the metric. */
  observation: string | undefined;
  /** Why a skipped check was skipped and what to do; empty unless skipped. */
  explanation: string | undefined;
  /** Whether this evaluation is one the reader should act on. */
  tone: "fired" | "quiet" | "attention";
}

const OUTCOME: Record<string, { text: string; tone: EvaluationPresentation["tone"] }> = {
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

/** Customer copy for each skip; every sentence names the thing the reader can change. */
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

const FALLBACK_SKIP_EXPLANATION =
  "This check could not run as the automation is configured. Edit the automation and check its graph, metric, and threshold.";

const isOperator = (value: string): value is GraphAlertOperator =>
  Object.hasOwn(OPERATOR_LABELS, value);

/** One recorded evaluation as reader copy: what happened, what was observed, and why. */
export function describeEvaluation(evaluation: RecordedEvaluation): EvaluationPresentation {
  const outcome = OUTCOME[evaluation.verdict];
  return {
    outcome: outcome?.text ?? "The automation was checked",
    observation: describeObservation(evaluation),
    explanation:
      evaluation.verdict === "skipped"
        ? (SKIP_EXPLANATION[evaluation.skipCode ?? ""] ?? FALLBACK_SKIP_EXPLANATION)
        : undefined,
    tone: outcome?.tone ?? "quiet",
  };
}

/** "observed 42, fires when greater than 100 over 1 hour": the two numbers the reader came for. */
function describeObservation({
  observedValue,
  threshold,
  operator,
  timePeriodMinutes,
}: RecordedEvaluation): string | undefined {
  if (observedValue === null) return undefined;
  const observed = `observed ${formatMetricValue(observedValue)}`;
  if (threshold === null) return observed;
  const comparison = operator && isOperator(operator) ? OPERATOR_LABELS[operator] : "past";
  const window = timePeriodMinutes ? ` over ${formatWindow(timePeriodMinutes)}` : "";
  return `${observed}, fires when ${comparison} ${formatMetricValue(threshold)}${window}`;
}

/** Two decimals distinguish values without noise; a whole number keeps its shape. */
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

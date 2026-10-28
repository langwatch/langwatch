/**
 * How an empty widget gets its data, in plain words: the SDK call, setting or integration that
 * sends what its query found none of. The rules: features/dashboards/WIDGET_STANDARD.md.
 */

import type { NavigableTarget } from "@langwatch/analytics-contract/chart-frame-protocol";

/** A setup step an empty card offers: its button's words and the page it opens. */
export interface WidgetSetupAction {
  readonly label: string;
  readonly target: NavigableTarget;
}

/** What an empty card says about getting its data, and the step it offers, when it has one. */
export interface EmptyWidgetGuidance {
  readonly line: string;
  readonly action?: WidgetSetupAction;
}

const SDK = "with the LangWatch SDK";

/** Trace fields with words of their own, by the column the completeness report names. */
const FIELD_GUIDANCE: Readonly<Record<string, string>> = {
  TotalCost:
    "Send the model name and token counts on your LLM spans, or add a price for your model in Settings.",
  UserId: `Send user_id in the trace metadata ${SDK}.`,
  ConversationId: `Send thread_id in the trace metadata ${SDK}.`,
  CustomerId: `Send customer_id in the trace metadata ${SDK}.`,
  TopicId: "Topics come from LangWatch's topic clustering over your traces.",
  SubTopicId: "Topics come from LangWatch's topic clustering over your traces.",
  SatisfactionScore:
    "LangWatch works out satisfaction scores from your traces; there is nothing to send.",
};

/** Units other than traces, by the words the completeness report counts in. */
const UNIT_GUIDANCE: Readonly<Record<string, string>> = {
  evaluations: "Evaluations come from the evaluators you run on your traces.",
  "simulation runs": "Simulation runs come from running scenarios with the Scenario SDK.",
};

/** What sends a field the query found on none of its rows. */
export function missingFieldGuidance({
  field,
  label,
  unit,
}: {
  field: string;
  label: string;
  unit: string;
}): string | undefined {
  const own = FIELD_GUIDANCE[field];
  if (own) return own;
  if (unit === "traces") return `Send ${label} on your traces ${SDK}.`;
  return UNIT_GUIDANCE[unit];
}

/**
 * What sends the rows a query found none of in the period. Traces get a setup step only in a
 * project that never received one: in any other, an empty period is quiet, not unset.
 */
export function noTrafficGuidance({
  unit,
  awaitsFirstTrace,
}: {
  unit: string;
  /** The project has never received a trace and is one that should. */
  awaitsFirstTrace: boolean;
}): EmptyWidgetGuidance | undefined {
  if (unit === "traces") {
    return awaitsFirstTrace
      ? {
          line: `Send traces ${SDK} to fill this widget.`,
          action: { label: "Set up tracing", target: "traces" },
        }
      : undefined;
  }
  const line = UNIT_GUIDANCE[unit];
  return line ? { line } : undefined;
}

import { CADENCE_LABELS } from "@langwatch/automations/cadences";
import {
  type AutomationDraft,
  cadenceIsSet,
  configIsComplete,
  configurationSummary,
  filtersAreSet,
  isNotifyAction,
  subjectIsSet,
} from "./draftReducer";
import { watchSummary, watchSummaryLine } from "./watchSummary";

/**
 * The three-step wizard (ADR-093 §4). Pure state machine, kept out of React so
 * the ordering, the completion rules, and the rail's one-line summaries are
 * unit-testable as plain functions.
 *
 * Create walks the steps in order; edit opens on Review and enters one step at
 * a time from there. Nothing here knows which of the two is happening — that is
 * the drawer's business. What lives here is only "which step comes next", "is
 * this step answered", and "what does an answered step say in one line".
 *
 * Schedules keep their own composer path, so this machine never sees a
 * `report` draft.
 */
export type WizardStep = "watch" | "delivery" | "review";

export const WIZARD_STEPS = ["watch", "delivery", "review"] as const;

export const WIZARD_STEP_LABELS: Record<WizardStep, string> = {
  watch: "Watch",
  delivery: "Delivery",
  review: "Review",
};

export function stepIndex(step: WizardStep): number {
  return WIZARD_STEPS.indexOf(step);
}

export function nextStep(step: WizardStep): WizardStep | null {
  return WIZARD_STEPS[stepIndex(step) + 1] ?? null;
}

export function previousStep(step: WizardStep): WizardStep | null {
  return stepIndex(step) === 0
    ? null
    : (WIZARD_STEPS[stepIndex(step) - 1] ?? null);
}

/**
 * Whether the author can jump straight to a step. Every step they have already
 * reached stays one click away — the step rail is what answers ADR-037's
 * objection that a stepper "blocks revisiting earlier choices".
 */
export function stepIsReachable({
  step,
  furthestStep,
}: {
  step: WizardStep;
  furthestStep: WizardStep;
}): boolean {
  return stepIndex(step) <= stepIndex(furthestStep);
}

/** Whether a step has been answered well enough to summarise it in the rail. */
export function stepIsComplete({
  step,
  draft,
}: {
  step: WizardStep;
  draft: AutomationDraft;
}): boolean {
  switch (step) {
    case "watch":
      // For a graph the threshold rule is part of what it watches, so the
      // step is only answered once the rule is too.
      return subjectIsSet(draft) && cadenceIsSet(draft);
    case "delivery":
      return configIsComplete(draft);
    case "review":
      // Review is the whole automation, so its check means "ready to save":
      // a name alone must not tick the last step while the first two are
      // still open.
      return (
        draft.name.trim().length > 0 &&
        stepIsComplete({ step: "watch", draft }) &&
        stepIsComplete({ step: "delivery", draft })
      );
  }
}

/**
 * The one line a completed step shows in the rail. `null` for a step with
 * nothing to say yet — the rail renders the step's own prompt instead.
 */
export function stepSummary({
  step,
  draft,
  graphName,
}: {
  step: WizardStep;
  draft: AutomationDraft;
  /** The watched graph's name, once its row has loaded. */
  graphName?: string | null;
}): string | null {
  switch (step) {
    case "watch":
      return watchStepSummary({ draft, graphName });
    case "delivery":
      return draft.action ? deliveryStepSummary(draft) : null;
    case "review":
      return draft.name.trim() || null;
  }
}

function watchStepSummary({
  draft,
  graphName,
}: {
  draft: AutomationDraft;
  graphName?: string | null;
}): string | null {
  const isWatchingGraph = draft.source === "customGraph";
  if (isWatchingGraph && !draft.customGraphId) return null;
  if (!isWatchingGraph && !subjectIsSet(draft)) return null;
  return watchSummaryLine(
    watchSummary({
      isWatchingGraph,
      graphName,
      filterQuery: draft.filterQuery,
      hasStructuredFilters: filtersAreSet(draft.filters),
    }),
  );
}

/**
 * Where it delivers and, for a trace automation, when — the two halves of the
 * Delivery step, so the rail line says what the step actually decided.
 */
function deliveryStepSummary(draft: AutomationDraft): string {
  const destination = configurationSummary(draft);
  if (draft.source !== "trace" || !isNotifyAction(draft)) return destination;
  return `${destination} · ${CADENCE_LABELS[draft.notificationCadence]}`;
}

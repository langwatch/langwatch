import { CADENCE_LABELS } from "@langwatch/automation-contract";

import type { ClientProviderRegistry, ProviderClients } from "../../../model/provider-registry.ts";
import {
  type AutomationDraft,
  cadenceIsSet,
  configIsComplete,
  configurationSummary,
  filtersAreSet,
  isNotifyAction,
  subjectIsSet,
  subjectIsValid,
} from "./draft-reducer.ts";
import { watchSummary, watchSummaryLine } from "./watch-summary.ts";

/**
 * The three-step wizard (ADR-093 §4) as a pure state machine: step order, whether a
 * step is answered, and its one-line summary. Create walks in order; edit opens on
 * Review. Reports keep their own composer, so this never sees a `report` draft.
 */
export type WizardStep = "watch" | "delivery" | "review";

export const WIZARD_STEPS = ["watch", "delivery", "review"] as const;

export const WIZARD_STEP_LABELS: Record<WizardStep, string> = {
  watch: "Watch",
  delivery: "Delivery",
  review: "Review",
};

/** The step's position in the wizard, from zero. */
export function stepIndex(step: WizardStep): number {
  return WIZARD_STEPS.indexOf(step);
}

/** The step after this one; the last step has none. */
export function findNextStep(step: WizardStep): WizardStep[] {
  const next = WIZARD_STEPS[stepIndex(step) + 1];
  return next ? [next] : [];
}

/** The step before this one; the first step has none. */
export function findPreviousStep(step: WizardStep): WizardStep[] {
  const previous = stepIndex(step) === 0 ? undefined : WIZARD_STEPS[stepIndex(step) - 1];
  return previous ? [previous] : [];
}

/** Every step the author has already reached stays one click away (ADR-037's objection). */
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
export function stepIsComplete<C extends ProviderClients>({
  step,
  draft,
  registry,
}: {
  step: WizardStep;
  draft: AutomationDraft<C>;
  registry: ClientProviderRegistry<C>;
}): boolean {
  switch (step) {
    case "watch":
      // For a graph the threshold rule is part of what it watches.
      return subjectIsValid(draft) && cadenceIsSet(draft);
    case "delivery":
      return configIsComplete(registry, draft);
    case "review":
      // "Ready to save": a name alone must not tick the last step.
      return (
        draft.name.trim().length > 0 &&
        stepIsComplete({ step: "watch", draft, registry }) &&
        stepIsComplete({ step: "delivery", draft, registry })
      );
  }
}

/** The one line a completed step shows in the rail; empty while it has nothing to say. */
export function stepSummary<C extends ProviderClients>({
  step,
  draft,
  registry,
  graphName,
}: {
  step: WizardStep;
  draft: AutomationDraft<C>;
  registry: ClientProviderRegistry<C>;
  /** The watched graph's name, once its row has loaded. */
  graphName?: string | null;
}): string {
  switch (step) {
    case "watch":
      return watchStepSummary({ draft, graphName });
    case "delivery":
      return draft.action ? deliveryStepSummary({ draft, registry }) : "";
    case "review":
      return draft.name.trim();
  }
}

function watchStepSummary<C extends ProviderClients>({
  draft,
  graphName,
}: {
  draft: AutomationDraft<C>;
  graphName?: string | null;
}): string {
  const isWatchingGraph = draft.source === "customGraph";
  if (isWatchingGraph && !draft.customGraphId) return "";
  if (!isWatchingGraph && !subjectIsSet(draft)) return "";
  return watchSummaryLine(
    watchSummary({
      isWatchingGraph,
      graphName,
      filterQuery: draft.filterQuery,
      hasStructuredFilters: filtersAreSet(draft.filters),
    }),
  );
}

/** Where it delivers and, for a trace automation, when: the two halves of the Delivery step. */
function deliveryStepSummary<C extends ProviderClients>({
  draft,
  registry,
}: {
  draft: AutomationDraft<C>;
  registry: ClientProviderRegistry<C>;
}): string {
  const destination = configurationSummary(registry, draft);
  if (draft.source !== "trace" || !isNotifyAction(draft)) return destination;
  return `${destination} · ${CADENCE_LABELS[draft.notificationCadence]}`;
}

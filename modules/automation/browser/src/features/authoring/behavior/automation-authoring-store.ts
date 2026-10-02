import { defineSlice } from "@langwatch/browser-host/global-store";

import type { ProviderClients } from "../../../model/provider-registry.ts";
import { type AutomationDraft, type DraftAction } from "../model/draft-reducer.ts";
import { stepIndex, type WizardStep } from "../model/wizard-steps.ts";

export const MAX_AUTOMATION_TEST_HISTORY = 5;

export interface AutomationTestFireAttempt {
  at: number;
  channel: "email" | "slack" | "webhook";
  status: "success" | "failure";
  recipientCount?: number;
  usedDefault?: boolean;
  errorTitle?: string;
  errorDetail?: string;
  httpStatus?: number;
}

export type AutomationAuthoringSection = null | "configuration";

export interface AutomationAuthoringStore<C extends ProviderClients> {
  draft: AutomationDraft<C>;
  section: AutomationAuthoringSection;
  /** The wizard step on screen (ADR-093 §4). */
  step: WizardStep;
  /** The furthest step reached, so the rail keeps earlier steps one click away. */
  furthestStep: WizardStep;
  testHistory: AutomationTestFireAttempt[];
  /** A completed condition row whose key cannot round-trip is excluded from the
   *  query, so without this flag Save would persist a wider automation. */
  hasInvalidConditionRows: boolean;
  dispatch: (action: DraftAction<C>) => void;
  /** Reported by the condition builder as its rows change. */
  setHasInvalidConditionRows: (isInvalid: boolean) => void;
  setSection: (section: AutomationAuthoringSection) => void;
  /** Reaching a later step never un-reaches an earlier one. Watch cannot be left
   *  while a condition row is invalid: leaving unmounts the builder, which
   *  clears the flag, and Save would then store a wider automation. */
  setStep: (step: WizardStep) => void;
  pushTestAttempt: (attempt: AutomationTestFireAttempt) => void;
  hydrate: (draft: AutomationDraft<C>) => void;
  reset: () => void;
}

export interface AutomationAuthoringModel<C extends ProviderClients> {
  readonly INITIAL_DRAFT: AutomationDraft<C>;
  reducer(state: AutomationDraft<C>, action: DraftAction<C>): AutomationDraft<C>;
}

/**
 * Declares the authoring slice (`automation:authoring`) in the global UI store. The
 * package owns transitions and state shape; the host supplies only its named
 * provider registry, whose forms may use its transport client.
 */
export function createAutomationAuthoringStore<C extends ProviderClients>(
  model: AutomationAuthoringModel<C>,
) {
  return defineSlice<AutomationAuthoringStore<C>>({
    name: "automation:authoring",
    create: (set) => ({
      draft: model.INITIAL_DRAFT,
      section: null,
      step: "watch",
      furthestStep: "watch",
      testHistory: [],
      hasInvalidConditionRows: false,
      dispatch: (action) => set((state) => ({ draft: model.reducer(state.draft, action) })),
      setHasInvalidConditionRows: (isInvalid) => set({ hasInvalidConditionRows: isInvalid }),
      setSection: (section) => set({ section }),
      setStep: (step) =>
        set((state) => {
          if (state.step === "watch" && state.hasInvalidConditionRows) return {};
          return {
            step,
            furthestStep:
              stepIndex(step) > stepIndex(state.furthestStep) ? step : state.furthestStep,
          };
        }),
      pushTestAttempt: (attempt) =>
        set((state) => ({
          testHistory: [attempt, ...state.testHistory].slice(0, MAX_AUTOMATION_TEST_HISTORY),
        })),
      hydrate: (draft) => set({ draft }),
      reset: () =>
        set({
          draft: model.INITIAL_DRAFT,
          section: null,
          step: "watch",
          furthestStep: "watch",
          testHistory: [],
          hasInvalidConditionRows: false,
        }),
    }),
  });
}

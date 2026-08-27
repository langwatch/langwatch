import { create } from "zustand";
import type { ProviderClients } from "../providers/registry";
import { type AutomationDraft, type DraftAction } from "../logic/draft-reducer";

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
  testHistory: AutomationTestFireAttempt[];
  dispatch: (action: DraftAction<C>) => void;
  setSection: (section: AutomationAuthoringSection) => void;
  pushTestAttempt: (attempt: AutomationTestFireAttempt) => void;
  hydrate: (draft: AutomationDraft<C>) => void;
  reset: () => void;
}

export interface AutomationAuthoringModel<C extends ProviderClients> {
  readonly INITIAL_DRAFT: AutomationDraft<C>;
  reducer(state: AutomationDraft<C>, action: DraftAction<C>): AutomationDraft<C>;
}

/**
 * Creates the process-local authoring state for one application host. The
 * package owns transitions and state shape; the host supplies only its named
 * provider registry, whose forms may use its transport client.
 */
export function createAutomationAuthoringStore<C extends ProviderClients>(
  model: AutomationAuthoringModel<C>,
) {
  return create<AutomationAuthoringStore<C>>((set) => ({
    draft: model.INITIAL_DRAFT,
    section: null,
    testHistory: [],
    dispatch: (action) => set((state) => ({ draft: model.reducer(state.draft, action) })),
    setSection: (section) => set({ section }),
    pushTestAttempt: (attempt) =>
      set((state) => ({
        testHistory: [attempt, ...state.testHistory].slice(0, MAX_AUTOMATION_TEST_HISTORY),
      })),
    hydrate: (draft) => set({ draft }),
    reset: () => set({ draft: model.INITIAL_DRAFT, section: null, testHistory: [] }),
  }));
}

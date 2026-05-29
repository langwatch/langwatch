import { create } from "zustand";
import {
  type AutomationDraft,
  type DraftAction,
  INITIAL_DRAFT,
  reducer,
} from "../logic/draftReducer";

export const MAX_TEST_HISTORY = 5;

/** A single test-fire press, held in-session. Cross-session history would
 *  come from the outbox-backed health view (ADR-029, separate stack). */
export interface TestFireAttempt {
  at: number;
  channel: "email" | "slack";
  status: "success" | "failure";
  recipientCount?: number;
  usedDefault?: boolean;
  errorTitle?: string;
  errorDetail?: string;
}

/** Which secondary drawer is currently open on top of the main view. */
export type Section = null | "filters" | "configuration";

export interface AutomationStore {
  /** Pure-state portion. The whole drawer is a view onto this. */
  draft: AutomationDraft;
  section: Section;
  testHistory: TestFireAttempt[];

  /** Drives the pure reducer. */
  dispatch: (action: DraftAction) => void;
  /** Open or close a secondary drawer. */
  setSection: (section: Section) => void;
  /** Prepend a test-fire attempt; cap at `MAX_TEST_HISTORY`. */
  pushTestAttempt: (attempt: TestFireAttempt) => void;
  /** Replace the whole draft (edit hydration path). */
  hydrate: (draft: AutomationDraft) => void;
  /** Wipe all drawer state. The orchestrator calls this on unmount so the
   *  next open is a clean slate. */
  reset: () => void;
}

/**
 * Singleton zustand store backing the automation drawer. Pure logic
 * stays in `logic/draftReducer.ts` — this store just runs `reducer`
 * inside `set` and exposes a few thin action helpers. Tests can use
 * `useAutomationStore.getState()` / `setState()` to drive interactions
 * without mounting React.
 */
export const useAutomationStore = create<AutomationStore>((set) => ({
  draft: INITIAL_DRAFT,
  section: null,
  testHistory: [],

  dispatch: (action) =>
    set((state) => ({ draft: reducer(state.draft, action) })),
  setSection: (section) => set({ section }),
  pushTestAttempt: (attempt) =>
    set((state) => ({
      testHistory: [attempt, ...state.testHistory].slice(0, MAX_TEST_HISTORY),
    })),
  hydrate: (draft) => set({ draft }),
  reset: () => set({ draft: INITIAL_DRAFT, section: null, testHistory: [] }),
}));

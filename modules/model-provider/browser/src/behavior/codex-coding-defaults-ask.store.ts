import { defineSlice } from "@langwatch/browser-host/global-store";

import type { ScopeAssignment } from "../model/scope-assignment.ts";

/**
 * Settings asks post-connect (unlike Langy/onboarding, which set it inline) since adding a row
 * isn't necessarily choosing org defaults. Queued here, not shown in-drawer, because the drawer
 * closes the moment connect completes and would unmount a dialog mid-question.
 */

export interface CodexCodingDefaultsAsk {
  projectId: string;
  /** The scopes the sign-in just saved the provider row at. */
  scopes: ScopeAssignment[];
}

export interface CodexCodingDefaultsAskState {
  pending: CodexCodingDefaultsAsk | null;
  request: (ask: CodexCodingDefaultsAsk) => void;
  clear: () => void;
}

/** The queued post-connect ask, a slice of the global UI store. */
export const useCodexCodingDefaultsAskStore = defineSlice<CodexCodingDefaultsAskState>({
  name: "model-provider:codex-coding-defaults-ask",
  create: (set) => ({
    pending: null,
    request: (ask) => set({ pending: ask }),
    clear: () => set({ pending: null }),
  }),
});

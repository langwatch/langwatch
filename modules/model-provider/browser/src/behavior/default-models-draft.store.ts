import { defineSlice } from "@langwatch/browser-host/global-store";
import type { ScopeTriadEntry } from "@langwatch/design-system/scope-chip-picker";

/**
 * The Default models drawer's unsaved edits, kept while Add key opens a provider form over it.
 * The drawer unmounts on that navigation, so the draft lives here and is restored on return.
 */
export interface DefaultModelsDraft {
  /** The config row id being edited, or the create marker for a new config. */
  target: string;
  scopes: ScopeTriadEntry[];
  config: Record<string, string>;
}

export interface DefaultModelsDraftState {
  draft: DefaultModelsDraft | null;
  keep: (draft: DefaultModelsDraft) => void;
  clear: () => void;
}

/** The kept Default models draft, a slice of the global UI store. */
export const useDefaultModelsDraftStore = defineSlice<DefaultModelsDraftState>({
  name: "model-provider:default-models-draft",
  create: (set) => ({
    draft: null,
    keep: (draft) => set({ draft }),
    clear: () => set({ draft: null }),
  }),
});

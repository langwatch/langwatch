import { create } from "zustand";

// The minted token is held in memory only, keyed by organisation, project and user: one holder
// for every Foundry surface, so the first send mints and the rest reuse it. Closing the drawer
// does not clear it; a new mint per open would only pile up tokens.
type HeldToken = { scopeKey: string; token: Promise<string> };
interface FoundryProjectStore {
  selectedProjectId: string | null;
  heldToken: HeldToken | null;
  // Property-typed: destructured off the store's return value, which
  // extracts it unbound. Doesn't read `this`, so this is a lint fix only.
  setSelectedProject: (projectId: string) => void;
  holdToken: (held: HeldToken | null) => void;
}

export const useFoundryProjectStore = create<FoundryProjectStore>((set) => ({
  selectedProjectId: null,
  heldToken: null,
  setSelectedProject(projectId) {
    set({ selectedProjectId: projectId });
  },
  holdToken(held) {
    set({ heldToken: held });
  },
}));

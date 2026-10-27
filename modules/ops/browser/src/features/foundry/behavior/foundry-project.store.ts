import { defineSlice } from "@langwatch/browser-host/global-store";

interface FoundryProjectStore {
  selectedProjectId: string | null;
  // Property-typed: destructured off the store's return value, which
  // extracts it unbound. Doesn't read `this`, so this is a lint fix only.
  setSelectedProject: (projectId: string) => void;
}

export const useFoundryProjectStore = defineSlice<FoundryProjectStore>({
  name: "ops:foundry-project",
  create: (set) => ({
    selectedProjectId: null,
    setSelectedProject(projectId) {
      set({ selectedProjectId: projectId });
    },
  }),
});

// The minted token, in this module's memory only (never a slice, storage, URL or mutation cache),
// keyed by organisation, project and user: the first send mints and every Foundry surface reuses
// it. Closing the drawer does not clear it; a new mint per open would only pile up tokens.
type HeldToken = { scopeKey: string; token: Promise<string> };
let heldToken: HeldToken | null = null;

export function heldFoundryToken(): HeldToken | null {
  return heldToken;
}

export function holdFoundryToken({ held }: { held: HeldToken | null }): void {
  heldToken = held;
}

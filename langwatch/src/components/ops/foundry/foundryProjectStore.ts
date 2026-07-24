import { create } from "zustand";

// The API key is held in memory (not persisted to localStorage) for the duration
// of the session. This is acceptable because The Foundry is gated behind ops
// permissions (admin / ops-org only), the key is the project's own API key
// fetched via an authenticated tRPC call, and it's only used to send OTel traces
// to the same origin. Clearing on drawer close would force a re-fetch on every
// open with no meaningful security gain.
interface FoundryProjectStore {
  selectedProjectId: string | null;
  selectedApiKey: string | null;
  setSelectedProject(projectId: string, apiKey: string): void;
}

export const useFoundryProjectStore = create<FoundryProjectStore>(
  (set) => ({
    selectedProjectId: null,
    selectedApiKey: null,
    setSelectedProject(projectId, apiKey) {
      set({ selectedProjectId: projectId, selectedApiKey: apiKey });
    },
  })
);

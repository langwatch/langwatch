import { create } from "zustand";

// The API key is held in memory only, for the session: The Foundry is
// gated behind ops permissions, the key is the project's own (fetched via
// an authenticated tRPC call), and it's only used to send OTel traces to
// the same origin. Clearing on drawer close would force a re-fetch with no security gain.
interface FoundryProjectStore {
  selectedProjectId: string | null;
  selectedApiKey: string | null;
  setSelectedProject(projectId: string, apiKey: string): void;
}

export const useFoundryProjectStore = create<FoundryProjectStore>((set) => ({
  selectedProjectId: null,
  selectedApiKey: null,
  setSelectedProject(projectId, apiKey) {
    set({ selectedProjectId: projectId, selectedApiKey: apiKey });
  },
}));

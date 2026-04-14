import { create } from "zustand";

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

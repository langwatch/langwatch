import { create } from "zustand";

interface FoundryTarget {
  projectId: string;
  organizationId: string;
}

// Ingestion keys are held in memory (never persisted to localStorage) for the
// session. The Foundry is gated behind ops permissions, each key is a personal
// API key the operator minted for one project that can only create traces,
// and it is only sent to the same origin.
interface FoundryProjectStore {
  selectedTarget: FoundryTarget | null;
  keysByProject: Record<string, string>;
  setSelectedTarget(target: FoundryTarget): void;
  rememberKey(projectId: string, token: string): void;
}

export const useFoundryProjectStore = create<FoundryProjectStore>((set) => ({
  selectedTarget: null,
  keysByProject: {},
  setSelectedTarget(target) {
    set({ selectedTarget: target });
  },
  rememberKey(projectId, token) {
    set((state) => ({
      keysByProject: { ...state.keysByProject, [projectId]: token },
    }));
  },
}));

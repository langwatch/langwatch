import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

export interface PromptInWorkspace {
  workspaceIndex: number;
  id: string;
  hasUnsavedChanges: boolean;
}

export interface PromptStudioStore {
  promptsInWorkspaces: PromptInWorkspace[];
  activeWorkspaceIndex: number | null;

  addPrompt: (params: { id: string; workspaceIndex: number }) => void;
  removePrompt: (params: { id: string }) => void;
  splitPrompt: (params: { id: string }) => number;
  getPromptIdsForWorkspaceIndex: (params: { workspaceIndex: number }) => string[];
  getWorkspaceCount: () => number;

  setActiveWorkspaceIndex: (index: number) => void;
}

export const usePromptStudioStore = create<PromptStudioStore>()(
  immer((set, get) => ({
    promptsInWorkspaces: [],
    activeWorkspaceIndex: null,

    addPrompt: ({ id, workspaceIndex }) => {
      set((s) => {
        const exists = s.promptsInWorkspaces.some(
          (r) => r.workspaceIndex === workspaceIndex && r.id === id,
        );
        if (!exists) {
          s.promptsInWorkspaces.push({
            workspaceIndex,
            id,
            hasUnsavedChanges: false,
          });
        }
      });
    },

    removePrompt: ({ id }) => {
      const active = get().activeWorkspaceIndex;
      if (active == null) return;
      set((s) => {
        s.promptsInWorkspaces = s.promptsInWorkspaces.filter(
          (r) => !(r.workspaceIndex === active && r.id === id),
        );
      });
    },

    splitPrompt: ({ id }) => {
      const rels = get().promptsInWorkspaces;
      const existing = rels.map((r) => r.workspaceIndex);
      const next = existing.length === 0 ? 0 : Math.max(...existing) + 1;

      const active = get().activeWorkspaceIndex;
      const source = rels.find((r) => r.workspaceIndex === active && r.id === id);
      const hasUnsavedChanges = source?.hasUnsavedChanges ?? false;

      set((s) => {
        const already = s.promptsInWorkspaces.some(
          (r) => r.workspaceIndex === next && r.id === id,
        );
        if (!already) {
          s.promptsInWorkspaces.push({
            workspaceIndex: next,
            id,
            hasUnsavedChanges,
          });
        }
        s.activeWorkspaceIndex = next;
      });

      return next;
    },

    getPromptIdsForWorkspaceIndex: ({ workspaceIndex }) => {
      return get()
        .promptsInWorkspaces
        .filter((r) => r.workspaceIndex === workspaceIndex)
        .map((r) => r.id);
    },

    getWorkspaceCount: () => {
      const indices = new Set(get().promptsInWorkspaces.map((r) => r.workspaceIndex));
      return indices.size;
    },

    setActiveWorkspaceIndex: (index: number) => {
      set((s) => {
        s.activeWorkspaceIndex = index;
      });
    },
  })),
);

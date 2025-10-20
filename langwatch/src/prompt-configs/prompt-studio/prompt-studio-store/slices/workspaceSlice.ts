import type { StateCreator } from "zustand";
import { randomUUID } from "@copilotkit/shared";
import type { PromptStudioStore } from "../store";
import type { PromptStudioWorkspacePromptData } from "./workspaceDataSlice";

export interface PromptWorkspace {
  id: string;
  prompts: PromptStudioWorkspacePromptData[];
}

export interface WorkspaceManagementSlice {
  addWorkspace: () => string;
  deleteWorkspace: (workspaceId: string) => void;
  setActiveWorkspace: (workspaceId: string) => void;
  getActiveWorkspace: () => PromptWorkspace | null;
  getWorkspace: (workspaceId: string) => PromptWorkspace | null;
  getCurrent: () => PromptWorkspace | null; // alias for convenience
}

export const createWorkspaceManagementSlice: StateCreator<
  PromptStudioStore & WorkspaceManagementSlice,
  [["zustand/immer", unknown]],
  [],
  WorkspaceManagementSlice
> = (set, get) => ({
  addWorkspace: () => {
    const workspaceId = randomUUID();
    set((state) => {
      const newWorkspace: PromptWorkspace = { id: workspaceId, prompts: [] };
      state.workspaces.push(newWorkspace);
      state.activeWorkspaceId = workspaceId;
    });
    return workspaceId;
  },
  deleteWorkspace: (workspaceId: string) => {
    set((state) => {
      state.workspaces = state.workspaces.filter(
        (w: PromptWorkspace) => w.id !== workspaceId,
      );
      if (state.activeWorkspaceId === workspaceId) {
        state.activeWorkspaceId = state.workspaces[0]?.id ?? null;
      }
    });
  },
  setActiveWorkspace: (workspaceId: string) => {
    set((state) => {
      const exists = state.workspaces.some(
        (w: PromptWorkspace) => w.id === workspaceId,
      );
      if (exists) state.activeWorkspaceId = workspaceId;
    });
  },
  getActiveWorkspace: () => {
    const state = get();
    if (!state.activeWorkspaceId) return null;
    return (
      state.workspaces.find(
        (w: PromptWorkspace) => w.id === state.activeWorkspaceId,
      ) ?? null
    );
  },
  getWorkspace: (workspaceId: string) => {
    const state = get();
    return (
      state.workspaces.find((w: PromptWorkspace) => w.id === workspaceId) ??
      null
    );
  },
  getCurrent: () => {
    const state = get();
    if (!state.activeWorkspaceId) return null;
    return (
      state.workspaces.find((w) => w.id === state.activeWorkspaceId) || null
    );
  },
});

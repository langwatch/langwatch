import type { StateCreator } from "zustand";
import { randomUUID } from "@copilotkit/shared";
import type { PromptStudioStore } from "../store";

export interface PromptStudioWorkspacePromptData {
  configId: string;
}

export interface WorkspaceDataSlice {
  addPrompt: (params: {
    prompt: PromptStudioWorkspacePromptData;
    workspaceId: string;
  }) => void;
  removePrompt: (params: { configId: string; workspaceId: string }) => void;
  addDraft: (params: { workspaceId: string }) => string;
}

export const createWorkspaceDataSlice: StateCreator<
  PromptStudioStore & WorkspaceDataSlice,
  [["zustand/immer", unknown]],
  [],
  WorkspaceDataSlice
> = (set, get) => ({
  addPrompt: ({ prompt, workspaceId }) => {
    set((state) => {
      const workspace = state.getWorkspace(workspaceId);
      if (!workspace) return;
      workspace.prompts.push(prompt);
    });
  },
  removePrompt: ({ configId, workspaceId }) => {
    set((state) => {
      const workspace = state.getWorkspace(workspaceId);
      if (!workspace) return;
      workspace.prompts = workspace.prompts.filter(
        (p: PromptStudioWorkspacePromptData) => p.configId !== configId,
      );
    });
  },
  addDraft: ({ workspaceId }) => {
    const draftId = randomUUID();
    set((state) => {
      const workspace = state.getWorkspace(workspaceId);
      if (!workspace) return;
      const newDraft: PromptStudioWorkspacePromptData = {
        configId: draftId,
      };
      workspace.prompts.push(newDraft);
    });
    return draftId;
  },
});

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import {
  createPromptStudioSlices,
  type PromptStudioSlicesUnion,
} from "./slices";
import type { PromptWorkspace } from "./slices/workspaceSlice";

interface CoreState {
  workspaces: PromptWorkspace[];
  activeWorkspaceId: string | null;
}

export type PromptStudioStore = CoreState & PromptStudioSlicesUnion;

export const usePromptStudioStore = create<
  PromptStudioStore & PromptStudioSlicesUnion
>()(
  immer((...args) => ({
    workspaces: [],
    activeWorkspaceId: null,
    ...createPromptStudioSlices(...args),
  })),
);

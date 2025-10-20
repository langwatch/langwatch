import type { StateCreator } from "zustand";
import type { PromptStudioStore } from "../store";
import {
  createWorkspaceManagementSlice,
  type WorkspaceManagementSlice,
} from "./workspaceSlice";
import {
  createWorkspaceDataSlice,
  type WorkspaceDataSlice,
} from "./workspaceDataSlice";

export type PromptStudioSlicesUnion = WorkspaceManagementSlice &
  WorkspaceDataSlice;

export const createPromptStudioSlices: StateCreator<
  PromptStudioStore & PromptStudioSlicesUnion,
  [["zustand/immer", unknown]],
  [],
  PromptStudioSlicesUnion
> = (...args) => ({
  ...createWorkspaceManagementSlice(...args),
  ...createWorkspaceDataSlice(...args),
});

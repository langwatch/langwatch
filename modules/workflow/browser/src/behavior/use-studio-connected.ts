import { useWorkflowStore } from "./use-workflow-store.ts";

/** Why a run control is disabled while the studio's connection status line is pending. */
export const WAITING_FOR_ENGINE = "Waiting for the engine to connect";

/** Whether the studio can start a run: its engine connection is up. */
export function useIsStudioConnected(): boolean {
  return useWorkflowStore((state) => state.socketStatus === "connected");
}

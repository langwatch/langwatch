/**
 * The run dialog as the Results tab reaches it: New run plan, and opening a
 * stored plan to change what it runs.
 *
 * A run plan is a name and a configuration, and the run dialog is where both
 * are chosen, so there is no separate editor. New run plan opens the dialog
 * with the scope still open; a stored plan opens it with the scope that plan
 * already holds.
 *
 * The page mounts this once.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { create } from "zustand";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useAgentTestingStore } from "../useAgentTestingStore";
import { storedPlanSubject } from "./plan-scope";
import { RunDialog } from "./RunDialog";
import type { RunDialogSubject } from "./run-dialog-types";

type RunPlanDialogStore = {
  /** The stored plan the dialog is open on, "new" for one being written. */
  openOn: { kind: "new" } | { kind: "plan"; suiteId: string } | null;
  openNew: () => void;
  openPlan: (suiteId: string) => void;
  close: () => void;
};

const useRunPlanDialogStore = create<RunPlanDialogStore>((set) => ({
  openOn: null,
  openNew: () => set({ openOn: { kind: "new" } }),
  openPlan: (suiteId) => set({ openOn: { kind: "plan", suiteId } }),
  close: () => set({ openOn: null }),
}));

/** Opens the run dialog with the scope still to be chosen. */
export function useOpenNewRunPlan(): () => void {
  return useRunPlanDialogStore((state) => state.openNew);
}

/** Opens the run dialog on a stored plan, so its configuration can change. */
export function useOpenRunPlan(): (suiteId: string) => void {
  return useRunPlanDialogStore((state) => state.openPlan);
}

export function RunPlanDialogHost() {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const openOn = useRunPlanDialogStore((state) => state.openOn);
  const close = useRunPlanDialogStore((state) => state.close);
  const setPendingRun = useAgentTestingStore((state) => state.setPendingRun);

  const suiteId = openOn?.kind === "plan" ? openOn.suiteId : "";
  const { data: suite } = api.suites.getById.useQuery(
    { projectId, id: suiteId },
    { enabled: !!projectId && !!suiteId },
  );

  const subject = ((): RunDialogSubject | null => {
    if (!openOn) return null;
    if (openOn.kind === "new") return { kind: "plan", initialTarget: null };
    // The dialog waits for the plan rather than opening on an empty one.
    if (!suite || suite.id !== suiteId) return null;
    return storedPlanSubject(suite);
  })();

  return (
    <RunDialog
      subject={subject}
      onClose={close}
      onRunStarted={({ batchRunId, scenarioSetId }) => {
        setPendingRun({ batchRunId, scenarioSetId });
      }}
    />
  );
}

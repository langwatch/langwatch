/**
 * The run dialog as the Results tab reaches it: New run plan, and opening a stored plan
 * to change what it runs.
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";

import { useAgentTestingStore } from "../../../../behavior/agent-testing/use-agent-testing-store.ts";
import { useRunPlanDialogStore } from "../../../../behavior/run-plan-dialog.store.ts";
import { useSuite } from "../../../../behavior/suites/use-suite.ts";
import { storedPlanSubject } from "./plan-scope.ts";
import type { RunDialogSubject } from "./run-dialog-types.ts";
import { RunDialog } from "./run-dialog.tsx";

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
  const { data: suite } = useSuite({ projectId, id: suiteId });

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

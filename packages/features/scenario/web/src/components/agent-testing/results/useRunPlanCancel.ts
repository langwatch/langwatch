/**
 * Stopping runs from the results view: one row, or the whole run.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { useCallback } from "react";
import { isOnPlatformSet, type ScenarioRunData } from "@langwatch/scenario-contract";
import { isSuiteSetId } from "@langwatch/suite-contract";
import { useCancelScenarioRun } from "../../suites/useCancelScenarioRun";
import { toaster } from "@langwatch/design-system/toaster";
import { showErrorToast } from "../../../behavior/errors";
import { useCan } from "../../../hooks/useCan";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project";
import { useAgentTestingStore } from "../useAgentTestingStore";

/** What the person is told once a cancellation lands, and the list reread. */
function cancelCallbacks({
  refetch,
  setCancellingJobId,
}: {
  refetch: () => void;
  setCancellingJobId: (jobId: string | null) => void;
}) {
  return {
    onCancelJobSuccess: () => {
      setCancellingJobId(null);
      refetch();
      toaster.create({ title: "Cancellation requested", type: "info" });
    },
    onCancelJobError: (error: { message: string }) => {
      setCancellingJobId(null);
      refetch();
      showErrorToast({ error, fallbackTitle: "Couldn't cancel job" });
    },
    onCancelBatchSuccess: () => {
      refetch();
      toaster.create({ title: "Jobs cancelled", type: "success" });
    },
    onCancelBatchError: (error: { message: string }) =>
      showErrorToast({ error, fallbackTitle: "Couldn't cancel jobs" }),
  };
}

export function useRunPlanCancel({
  scenarioSetId,
  selectedBatchRunId,
  refetch,
}: {
  scenarioSetId: string;
  selectedBatchRunId: string | null;
  refetch: () => void;
}) {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const { can } = useCan();
  const cancellingJobId = useAgentTestingStore((state) => state.cancellingJobId);
  const setCancellingJobId = useAgentTestingStore((state) => state.setCancellingJobId);

  const { cancelJob, cancelBatchRun, isCancellingBatch } = useCancelScenarioRun(
    cancelCallbacks({ refetch, setCancellingJobId }),
  );

  // Only a set the platform runs can be stopped from here, and only by a
  // person who may manage runs.
  const canStop =
    can("scenarios:manage") && (isOnPlatformSet(scenarioSetId) || isSuiteSetId(scenarioSetId));

  const handleCancelRun = useCallback(
    (scenarioRun: ScenarioRunData) => {
      if (!projectId) return;
      setCancellingJobId(scenarioRun.scenarioRunId);
      cancelJob({
        projectId,
        scenarioSetId,
        batchRunId: scenarioRun.batchRunId,
        scenarioRunId: scenarioRun.scenarioRunId,
        scenarioId: scenarioRun.scenarioId,
      });
    },
    [projectId, scenarioSetId, cancelJob, setCancellingJobId],
  );

  const handleCancelAll = useCallback(() => {
    if (!projectId || !selectedBatchRunId) return;
    cancelBatchRun({
      projectId,
      scenarioSetId,
      batchRunId: selectedBatchRunId,
    });
  }, [projectId, scenarioSetId, selectedBatchRunId, cancelBatchRun]);

  return {
    canStop,
    cancellingJobId,
    isCancellingBatch,
    handleCancelRun,
    handleCancelAll,
  };
}

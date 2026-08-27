/**
 * Archiving a run plan from the Results tab.
 *
 * A run plan is made by typing its name in the run dialog, so a typo or an
 * abandoned experiment leaves a plan behind. Archiving takes the row out of
 * the list and keeps every run it already holds.
 *
 * A plan stored as a test suite folder is archived through the same call the
 * Scenarios rail uses, so the scenarios filed in it go with it and the two
 * tabs never disagree about what exists.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { useCallback } from "react";
import { showErrorToast } from "~/features/errors";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { RunPlan } from "./run-plans";

export type RunPlanArchive = {
  isArchiving: boolean;
  archivePlan: (plan: RunPlan) => void;
};

export function useRunPlanArchive(): RunPlanArchive {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const utils = api.useUtils();

  /**
   * The four reads a plan row is drawn from: the two the Scenarios tab reads,
   * plus the suite list and the run summaries of the Results tab.
   */
  const invalidate = useCallback(() => {
    void utils.scenarios.getAll.invalidate({ projectId });
    void utils.suites.folders.getAll.invalidate({ projectId });
    void utils.suites.getAll.invalidate({ projectId });
    void utils.suites.getSummaries.invalidate({ projectId });
  }, [utils, projectId]);

  const onError = (error: unknown) =>
    showErrorToast({ error, fallbackTitle: "Couldn't archive the run plan" });

  const archiveSuite = api.suites.archive.useMutation({
    onSuccess: invalidate,
    onError,
  });

  const archiveFolder = api.suites.folders.archive.useMutation({
    onSuccess: invalidate,
    onError,
  });

  return {
    isArchiving: archiveSuite.isPending || archiveFolder.isPending,
    archivePlan: (plan) => {
      // A set that runs from code has no stored plan to archive.
      if (!plan.suiteId) return;
      if (plan.suiteKind === "folder") {
        archiveFolder.mutate({ projectId, folderId: plan.suiteId });
        return;
      }
      archiveSuite.mutate({ projectId, id: plan.suiteId });
    },
  };
}

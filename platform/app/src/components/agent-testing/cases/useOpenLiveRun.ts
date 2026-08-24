/**
 * Opens one run of a test case in the run detail drawer.
 *
 * This is the single place the Test cases tab opens a run from, whether the
 * run just started or finished days ago. The live-run track replaces the body
 * of `openLiveRun` with the wide streaming drawer; every caller here stays as
 * it is.
 *
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/features/agent-testing/live-one-off-run.feature
 */

import { useCallback } from "react";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

export type OpenLiveRunParams = {
  batchRunId: string;
  /** The run set the batch landed in, needed to read the batch back. */
  scenarioSetId: string;
  /** The run itself, when the caller already knows it. */
  scenarioRunId?: string;
  /** The case whose run to open, when the batch holds several. */
  scenarioId?: string;
};

export function useOpenLiveRun() {
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const utils = api.useUtils();
  const projectId = project?.id ?? "";

  /**
   * Opens the drawer on a run. When only the batch is known, the batch is
   * read back to find the run of the case that was asked for.
   */
  const openLiveRun = useCallback(
    async ({
      batchRunId,
      scenarioSetId,
      scenarioRunId,
      scenarioId,
    }: OpenLiveRunParams) => {
      let runId = scenarioRunId;

      if (!runId && projectId && batchRunId && scenarioSetId) {
        const result = await utils.scenarios.getBatchRunData.fetch({
          projectId,
          scenarioSetId,
          batchRunId,
        });
        const runs = "runs" in result ? result.runs : [];
        runId =
          runs.find((run) => run.scenarioId === scenarioId)?.scenarioRunId ??
          runs[0]?.scenarioRunId;
      }

      if (!runId) return;
      openDrawer("scenarioRunDetail", { urlParams: { scenarioRunId: runId } });
    },
    [openDrawer, projectId, utils],
  );

  return { openLiveRun };
}

/**
 * Opens one run of a test case in the wide run detail drawer.
 *
 * This is the single place the Test cases tab opens a run from, whether the
 * run just started or finished days ago. A run that has no id yet opens on
 * its batch: the drawer watches the batch until the run appears and then
 * streams the conversation in live.
 *
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/features/agent-testing/live-one-off-run.feature
 */

import { useCallback } from "react";
import { useDrawer } from "@langwatch/ui-drawer";

export type OpenLiveRunParams = {
  batchRunId: string;
  /** The run set the batch landed in, needed to read the batch back. */
  scenarioSetId: string;
  /** The run itself, when the caller already knows it. */
  scenarioRunId?: string;
  /** The case whose run to open, when the batch holds several. */
  scenarioId?: string;
  /** The agent the run went against, named while the run is still queued. */
  targetId?: string;
};

export function useOpenLiveRun() {
  const { openDrawer } = useDrawer();

  const openLiveRun = useCallback(
    ({
      batchRunId,
      scenarioSetId,
      scenarioRunId,
      scenarioId,
      targetId,
    }: OpenLiveRunParams) => {
      openDrawer("scenarioRunDetail", {
        urlParams: {
          variant: "agent-testing",
          batchRunId,
          scenarioSetId,
          ...(scenarioRunId ? { scenarioRunId } : {}),
          ...(scenarioId ? { scenarioId } : {}),
          ...(targetId ? { targetId } : {}),
        },
      });
    },
    [openDrawer],
  );

  return { openLiveRun };
}

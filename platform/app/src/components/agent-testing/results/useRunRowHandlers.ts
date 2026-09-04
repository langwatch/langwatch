/**
 * What one result row reaches: the name of the target it ran against, the run
 * drawer, and the editor of the scenario behind it.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { useCallback } from "react";
import { useDrawer } from "~/hooks/useDrawer";
import { useTargetNameMap } from "~/hooks/useTargetNameMap";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { CASE_EDITOR_DRAWER } from "../cases/drawerKeys";

export function useRunRowHandlers({
  scenarioSetId,
}: {
  scenarioSetId: string;
}) {
  const { openDrawer } = useDrawer();
  const targetNameMap = useTargetNameMap();

  const resolveTargetName = useCallback(
    (scenarioRun: ScenarioRunData): string | null => {
      const refId = scenarioRun.metadata?.langwatch?.targetReferenceId;
      if (!refId) return null;
      return targetNameMap.get(refId) ?? refId;
    },
    [targetNameMap],
  );

  const handleScenarioRunClick = useCallback(
    (scenarioRun: ScenarioRunData) => {
      openDrawer("scenarioRunDetail", {
        urlParams: {
          variant: "agent-testing",
          scenarioRunId: scenarioRun.scenarioRunId,
          batchRunId: scenarioRun.batchRunId,
          scenarioSetId,
        },
      });
    },
    [openDrawer, scenarioSetId],
  );

  const handleEditCase = useCallback(
    (scenarioRun: ScenarioRunData) =>
      openDrawer(CASE_EDITOR_DRAWER, { scenarioId: scenarioRun.scenarioId }),
    [openDrawer],
  );

  return { resolveTargetName, handleScenarioRunClick, handleEditCase };
}

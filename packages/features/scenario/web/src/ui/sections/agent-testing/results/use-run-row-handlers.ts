/**
 * What one result row reaches: the name of the target it ran against, the run
 * drawer, and the editor of the test case behind it.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { useCallback } from "react";
import { useDrawer } from "@langwatch/ui-drawer";
import { useTargetNameMap } from "../../../../behavior/use-target-name-map";
import type { ScenarioRunData } from "@langwatch/scenario-contract";
import { useAgentTestingStore } from "../use-agent-testing-store";

export function useRunRowHandlers({
  scenarioSetId,
}: {
  scenarioSetId: string;
}) {
  const { openDrawer } = useDrawer();
  const targetNameMap = useTargetNameMap();
  const openCaseEditor = useAgentTestingStore((state) => state.openCaseEditor);

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
      openCaseEditor({ scenarioId: scenarioRun.scenarioId }),
    [openCaseEditor],
  );

  return { resolveTargetName, handleScenarioRunClick, handleEditCase };
}

/**
 * Renders scenario runs as either a grid of cards or a list of rows.
 *
 * Shared between RunRow (ungrouped view) and BatchSection (grouped view)
 * to avoid duplicating the grid/list rendering logic.
 */

import { Grid, VStack } from "@chakra-ui/react";
import { ScenarioGridCard } from "./ScenarioGridCard";
import { ScenarioTargetRow } from "./ScenarioTargetRow";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import type { ViewMode } from "./useRunHistoryStore";

type ScenarioRunContentProps = {
  scenarioRuns: ScenarioRunData[];
  viewMode: ViewMode;
  resolveTargetName: (scenarioRun: ScenarioRunData) => string | null;
  onScenarioRunClick: (scenarioRun: ScenarioRunData) => void;
  iterationMap: Map<string, number>;
  onCancelRun?: (scenarioRun: ScenarioRunData) => void;
  cancellingJobId?: string | null;
};

export function ScenarioRunContent({
  scenarioRuns,
  viewMode,
  resolveTargetName,
  onScenarioRunClick,
  iterationMap,
  onCancelRun,
  cancellingJobId,
}: ScenarioRunContentProps) {
  if (viewMode === "grid") {
    return (
      <Grid
        templateColumns="repeat(auto-fill, minmax(250px, 1fr))"
        gap={4}
        padding={4}
        position="relative"
        zIndex={0}
        data-testid="scenario-grid"
      >
        {scenarioRuns.map((scenarioRun) => (
          <ScenarioGridCard
            key={scenarioRun.scenarioRunId}
            scenarioRun={scenarioRun}
            targetName={resolveTargetName(scenarioRun)}
            onClick={() => onScenarioRunClick(scenarioRun)}
            iteration={iterationMap.get(scenarioRun.scenarioRunId)}
            onCancel={onCancelRun ? () => onCancelRun(scenarioRun) : undefined}
            isCancelling={cancellingJobId === scenarioRun.scenarioRunId}
          />
        ))}
      </Grid>
    );
  }

  return (
    <VStack align="stretch" gap={0} data-testid="scenario-list">
      {scenarioRuns.map((scenarioRun) => (
        <ScenarioTargetRow
          key={scenarioRun.scenarioRunId}
          scenarioRun={scenarioRun}
          targetName={resolveTargetName(scenarioRun)}
          onClick={() => onScenarioRunClick(scenarioRun)}
          iteration={iterationMap.get(scenarioRun.scenarioRunId)}
          onCancel={onCancelRun ? () => onCancelRun(scenarioRun) : undefined}
          isCancelling={cancellingJobId === scenarioRun.scenarioRunId}
        />
      ))}
    </VStack>
  );
}

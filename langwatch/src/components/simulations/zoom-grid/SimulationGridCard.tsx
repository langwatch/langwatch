import React from "react";
import { Box } from "@chakra-ui/react";
import { SimulationChatViewer } from "../SimulationChatViewer";
import { GRID_CONSTANTS } from "./constants";
import type { ScenarioRunData } from "~/app/api/scenario-events/[[...route]]/types";

interface SimulationGridCardProps {
  runState: ScenarioRunData;
  onClick: (id: string) => void;
}

/**
 * Memoized card component for individual simulation in the grid.
 * Single Responsibility: Render a single simulation card with performance optimization.
 *
 * Uses React.memo to prevent unnecessary re-renders when parent grid resizes/zooms.
 */
export const SimulationGridCard = React.memo<SimulationGridCardProps>(
  ({ runState, onClick }) => (
    <Box
      width="full"
      height={`${GRID_CONSTANTS.CARD_HEIGHT}px`}
      cursor="pointer"
      onClick={() => onClick(runState.scenarioRunId)}
      overflow="auto"
      style={{
        minWidth: 0,
        minHeight: 0,
        contentVisibility: "auto", // Browser skips off-screen cards
        containIntrinsicSize: `${GRID_CONSTANTS.TARGET_CARD_WIDTH}px ${GRID_CONSTANTS.CARD_HEIGHT}px`,
        contain: "layout style paint", // Isolate rendering
      }}
    >
      <SimulationChatViewer runState={runState} />
    </Box>
  ),
);

SimulationGridCard.displayName = "SimulationGridCard";

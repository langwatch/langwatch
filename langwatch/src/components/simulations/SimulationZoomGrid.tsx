import { Grid, Box } from "@chakra-ui/react";
import { SimulationChatViewer } from "./SimulationChatViewer";
import { useSimulationRouter } from "~/hooks/simulations/useSimulationRouter";

interface SimulationZoomGridProps {
  scenarioRunIds: string[];
  scale: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * This component is a grid of simulation cards that can be zoomed in and out.
 * Can be used with the useZoom hook to zoom in and out of the grid.
 * @param scenarioRunIds - The IDs of the scenario runs to display.
 * @param scale - The scale of the grid.
 * @param containerRef - The ref to the container of the grid.
 * @returns A grid of simulation cards that can be zoomed in and out.
 */
export function SimulationZoomGrid({
  scenarioRunIds,
  scale,
  containerRef,
}: SimulationZoomGridProps) {
  const { goToSimulationRun } = useSimulationRouter();

  const handleExpandToggle = (simulationId: string) => {
    goToSimulationRun(simulationId);
  };

  // Calculate number of columns based on scale
  const getColsCount = () => {
    const baseColumns = 3;
    const calculatedColumns = Math.ceil(baseColumns / scale);
    return calculatedColumns;
  };

  return (
    <Box
      ref={containerRef}
      overflow="hidden"
      style={{
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      <Grid
        templateColumns={`repeat(${getColsCount()}, 1fr)`}
        gap={6}
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          width: `${100 / scale}%`,
          height: `${100 / scale}%`,
        }}
      >
        {scenarioRunIds?.map((scenarioRunId) => (
          <Box key={scenarioRunId} width="full" height="400px">
            <SimulationChatViewer
              scenarioRunId={scenarioRunId}
              isExpanded={false}
              onExpandToggle={() => handleExpandToggle(scenarioRunId)}
            />
          </Box>
        ))}
      </Grid>
    </Box>
  );
}

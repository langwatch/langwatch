import { useCallback, useMemo, useLayoutEffect, useState } from "react";
import { Grid, Box } from "@chakra-ui/react";
import { useSimulationRouter } from "~/hooks/simulations/useSimulationRouter";
import { useZoomContext } from "./zoomContext";
import { SimulationGridCard } from "./SimulationGridCard";
import { GRID_CONSTANTS } from "./constants";

interface ZoomGridProps {
  scenarioRunIds: string[];
  onCardClick?: (id: string) => void;
  emptyMessage?: string;
}

/**
 * Grid component that renders scaled simulation cards in responsive columns.
 * Single Responsibility: Manage responsive grid layout with zoom support.
 */
export function ZoomGrid({
  scenarioRunIds,
  onCardClick,
  emptyMessage = "No simulations to display",
}: ZoomGridProps) {
  const { scale, containerRef } = useZoomContext();
  const { goToSimulationRun, scenarioSetId, batchRunId } =
    useSimulationRouter();

  const [containerWidth, setContainerWidth] = useState(0);

  /**
   * Calculate gap in pixels from Chakra spacing units.
   * Constant per component instance.
   */
  const gapInPixels = GRID_CONSTANTS.GRID_GAP_MULTIPLIER * 4;

  /**
   * Memoized handler to prevent recreating on every render.
   * Navigates to a specific simulation run when card is clicked.
   */
  const handleExpandToggle = useCallback(
    (simulationId: string) => {
      if (onCardClick) {
        onCardClick(simulationId);
        return;
      }

      if (scenarioSetId && batchRunId) {
        goToSimulationRun({
          scenarioSetId,
          batchRunId,
          scenarioRunId: simulationId,
        });
      } else {
        console.warn("scenarioSetId or batchRunId is not defined");
      }
    },
    [onCardClick, scenarioSetId, batchRunId, goToSimulationRun],
  );

  /**
   * Memoized grid style with zoom property for natural scaling.
   * Zoom is now Baseline (May 2024) and works across all major browsers.
   */
  const gridStyle = useMemo(
    () => ({
      zoom: scale,
      willChange: "zoom",
    }),
    [scale],
  );

  /**
   * Calculate optimal column count based on container width and scale.
   * Uses useMemo to avoid recalculation on unrelated renders.
   */
  const colsCount = useMemo(() => {
    if (containerWidth === 0) return GRID_CONSTANTS.FALLBACK_COLUMNS;

    const effectiveCardWidth = GRID_CONSTANTS.TARGET_CARD_WIDTH * scale;
    const maxColumns = Math.floor(
      (containerWidth + gapInPixels) / (effectiveCardWidth + gapInPixels),
    );

    return Math.max(GRID_CONSTANTS.MIN_COLUMNS, maxColumns);
  }, [containerWidth, scale, gapInPixels]);

  /**
   * Measure container width using ResizeObserver with RAF debouncing.
   * Prevents layout thrashing during rapid resize events.
   */
  useLayoutEffect(() => {
    let rafId: number;

    const measureWidth = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setContainerWidth(rect.width);
      }
    };

    const debouncedMeasure = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(measureWidth);
    };

    measureWidth();

    const resizeObserver = new ResizeObserver(debouncedMeasure);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
    };
  }, [containerRef]);

  if (!scenarioRunIds?.length) {
    return (
      <Box textAlign="center" py={8} color="gray.500">
        {emptyMessage}
      </Box>
    );
  }

  return (
    <Box
      ref={containerRef}
      overflow="hidden"
      role="region"
      aria-label="Simulation grid"
      style={{
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      <Grid
        templateColumns={`repeat(${colsCount}, 1fr)`}
        gap={GRID_CONSTANTS.GRID_GAP_MULTIPLIER}
        style={gridStyle}
      >
        {scenarioRunIds.map((scenarioRunId) => (
          <SimulationGridCard
            key={scenarioRunId}
            scenarioRunId={scenarioRunId}
            onClick={handleExpandToggle}
          />
        ))}
      </Grid>
    </Box>
  );
}

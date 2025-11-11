import React, {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
} from "react";
import { Grid, Box, Button, HStack } from "@chakra-ui/react";
import { ZoomIn, ZoomOut } from "react-feather";
import { SimulationChatViewer } from "./SimulationChatViewer";
import { useSimulationRouter } from "~/hooks/simulations/useSimulationRouter";
import { useZoom } from "~/hooks/useZoom";
import { useOtel } from "~/observability/react-otel/useOtel";
import { AnalyticsBoundary, type AnalyticsEmitter } from "react-contextual-analytics";

const ZoomContext = createContext<ReturnType<typeof useZoom> | null>(null);

const useZoomContext = () => {
  const context = useContext(ZoomContext);
  if (!context) {
    throw new Error(
      "Zoom components must be used within SimulationZoomGrid.Root"
    );
  }
  return context;
};

// Root component that provides zoom context
interface RootProps {
  children: React.ReactNode;
}

function Root({ children }: RootProps) {
  const zoom = useZoom();

  return <ZoomContext.Provider value={zoom}>{children}</ZoomContext.Provider>;
}

// Controls component for zoom in/out buttons
interface ControlsProps {
  showScale?: boolean;
}

function Controls({ showScale = true }: ControlsProps) {
  const { scale, zoomIn, zoomOut } = useZoomContext();
  const { addEvent } = useOtel();

  const handleZoomOut = (emitter: AnalyticsEmitter) => () => {
    addEvent("Zoom Changed", { direction: "out", level: scale });
    emitter("clicked", "zoom-out", { level: scale });
    zoomOut();
  };

  const handleZoomIn = (emitter: AnalyticsEmitter) => () => {
    addEvent("Zoom Changed", { direction: "in", level: scale });
    emitter("clicked", "zoom-in", { level: scale });
    zoomIn();
  };

  return (
    <AnalyticsBoundary
      name="zoom_grid"
      attributes={{ scale: Math.round(scale * 100) }}
    >
      {(emitter) => (
        <HStack gap={2}>
          <Button
            bgColor="white"
            size="sm"
            variant="outline"
          onClick={() => handleZoomOut(emitter)}
        >
          Zoom Out <ZoomOut size={16} />
        </Button>
        <Button
          bgColor="white"
          size="sm"
          variant="outline"
          onClick={() => handleZoomIn(emitter)}
          >
            Zoom In <ZoomIn size={16} />
          </Button>
          {showScale && (
            <Box
              px={2}
              py={1}
              bg="gray.200"
              borderRadius="full"
              fontSize="xs"
              fontFamily="mono"
              fontWeight="bold"
            >
              {Math.round(scale * 100)}%
            </Box>
          )}
        </HStack>
      )}
    </AnalyticsBoundary>
  );
}

// Grid component that renders the scaled simulation grid
interface GridProps {
  scenarioRunIds: string[];
}

function GridComponent({ scenarioRunIds }: GridProps) {
  const { scale, containerRef } = useZoomContext();
  const { goToSimulationRun, scenarioSetId, batchRunId } =
    useSimulationRouter();

  // State to track container dimensions and column count
  const [containerWidth, setContainerWidth] = useState(0);
  const [colsCount, setColsCount] = useState(3);

  // Constants for precise grid calculations
  const TARGET_CARD_WIDTH = 320; // Target width for cards at 100% scale
  const GRID_GAP = 24; // 6 * 4px from gap={6} in Chakra UI

  const handleExpandToggle = (emitter: (action: string, name?: string, attributes?: Record<string, any>) => void) => (simulationId: string) => {
    emitter("clicked", "open-run", { scenarioRunId: simulationId });
    if (scenarioSetId && batchRunId) {
      goToSimulationRun({
        scenarioSetId,
        batchRunId,
        scenarioRunId: simulationId,
      });
    } else {
      console.warn("scenarioSetId or batchRunId is not defined");
    }
  };

  // Calculate optimal column count based on container width and scale
  const calculateColsCount = useCallback(() => {
    if (containerWidth === 0) return 3; // fallback while measuring

    // Calculate effective card width considering current scale
    const effectiveCardWidth = TARGET_CARD_WIDTH * scale;

    // Calculate how many cards can fit, accounting for gaps
    // Formula: (availableWidth + gap) / (cardWidth + gap)
    const maxColumns = Math.floor(
      (containerWidth + GRID_GAP) / (effectiveCardWidth + GRID_GAP)
    );

    return Math.max(1, maxColumns);
  }, [containerWidth, scale]);

  // Measure container width using ResizeObserver for accuracy
  useLayoutEffect(() => {
    const measureWidth = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setContainerWidth(rect.width);
      }
    };

    measureWidth();

    const resizeObserver = new ResizeObserver(measureWidth);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => resizeObserver.disconnect();
  }, [containerRef]);

  // Update column count when width or scale changes
  useLayoutEffect(() => {
    const newColsCount = calculateColsCount();
    setColsCount(newColsCount);
  }, [calculateColsCount]);

  return (
    <AnalyticsBoundary
      name="grid"
      attributes={{
        scale: Math.round(scale * 100),
        colsCount,
        scenarioSetId: scenarioSetId ?? "unknown",
        batchRunId: batchRunId ?? "unknown"
      }}
    >
      {(emitter) => (
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
            templateColumns={`repeat(${colsCount}, 1fr)`}
            gap={6}
            style={{
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              width: `${100 / scale}%`,
              height: `${100 / scale}%`,
            }}
          >
            {scenarioRunIds?.map((scenarioRunId) => (
              <Box
                key={scenarioRunId}
                width="full"
                height="400px"
                cursor="pointer"
                onClick={() => handleExpandToggle(emitter)(scenarioRunId)}
                overflow="auto"
                style={{
                  minWidth: 0,
                  minHeight: 0,
                }}
              >
                <SimulationChatViewer scenarioRunId={scenarioRunId} />
              </Box>
            ))}
          </Grid>
        </Box>
      )}
    </AnalyticsBoundary>
  );
}

// Export compound component
export const SimulationZoomGrid = {
  Root,
  Controls,
  Grid: GridComponent,
};

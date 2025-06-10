import React, {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
} from "react";
import { Grid, Box, Button, HStack } from "@chakra-ui/react";
import { ZoomIn, ZoomOut } from "react-feather";
import { SimulationChatViewer } from "./SimulationChatViewer";
import { useSimulationRouter } from "~/hooks/simulations/useSimulationRouter";
import { useZoom } from "~/hooks/useZoom";

// Context for zoom state
interface ZoomContextType {
  scale: number;
  containerRef: React.RefObject<HTMLDivElement>;
  zoomIn: () => void;
  zoomOut: () => void;
}

const ZoomContext = createContext<ZoomContextType | null>(null);

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

  return (
    <HStack gap={2}>
      <Button bgColor="white" size="sm" variant="outline" onClick={zoomOut}>
        Zoom Out <ZoomOut size={16} />
      </Button>
      <Button bgColor="white" size="sm" variant="outline" onClick={zoomIn}>
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
  );
}

// Grid component that renders the scaled simulation grid
interface GridProps {
  scenarioRunIds: string[];
}

function GridComponent({ scenarioRunIds }: GridProps) {
  const { scale, containerRef } = useZoomContext();
  const { goToSimulationRun } = useSimulationRouter();

  // State to track container dimensions and column count
  const [containerWidth, setContainerWidth] = useState(0);
  const [colsCount, setColsCount] = useState(3);

  // Constants for precise grid calculations
  const TARGET_CARD_WIDTH = 320; // Target width for cards at 100% scale
  const GRID_GAP = 24; // 6 * 4px from gap={6} in Chakra UI

  const handleExpandToggle = (simulationId: string) => {
    goToSimulationRun(simulationId);
  };

  // Calculate optimal column count based on container width and scale
  const calculateColsCount = () => {
    if (containerWidth === 0) return 3; // fallback while measuring

    // Calculate effective card width considering current scale
    const effectiveCardWidth = TARGET_CARD_WIDTH * scale;

    // Calculate how many cards can fit, accounting for gaps
    // Formula: (availableWidth + gap) / (cardWidth + gap)
    const maxColumns = Math.floor(
      (containerWidth + GRID_GAP) / (effectiveCardWidth + GRID_GAP)
    );

    return Math.max(1, maxColumns);
  };

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
  }, [containerWidth, scale]);

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

// Export compound component
export const SimulationZoomGrid = {
  Root,
  Controls,
  Grid: GridComponent,
};

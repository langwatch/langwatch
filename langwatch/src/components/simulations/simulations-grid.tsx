import { Grid, Box } from "@chakra-ui/react";
import { useRef } from "react";

interface ZoomGridProps {
  children: React.ReactNode;
  scale: number;
}

// Main layout for the Simulation Sets page
export default function ZoomGrid({ scale, children }: ZoomGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);

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
        {children}
      </Grid>
    </Box>
  );
}

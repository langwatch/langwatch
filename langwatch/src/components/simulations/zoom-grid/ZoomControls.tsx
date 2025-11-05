import { Button, HStack, Box } from "@chakra-ui/react";
import { ZoomIn, ZoomOut } from "react-feather";
import { useZoomContext } from "./zoomContext";

interface ZoomControlsProps {
  showScale?: boolean;
}

/**
 * Controls component for zoom in/out buttons and scale display.
 * Single Responsibility: Render zoom controls UI and handle user interactions.
 */
export function ZoomControls({ showScale = true }: ZoomControlsProps) {
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

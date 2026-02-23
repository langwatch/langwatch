import { Box, Button, HStack, Text } from "@chakra-ui/react";
import { Archive } from "lucide-react";

export function BatchActionBar({
  selectedCount,
  onArchive,
}: {
  selectedCount: number;
  onArchive: () => void;
}) {
  if (selectedCount === 0) return null;

  return (
    <Box
      position="fixed"
      bottom={10}
      left="50%"
      transform="translateX(-50%)"
      backgroundColor="#ffffff"
      border="1px solid #ccc"
      boxShadow="0 0 15px rgba(0, 0, 0, 0.2)"
      borderRadius="md"
      padding="8px"
      paddingX="16px"
      zIndex={1000}
      data-testid="batch-action-bar"
    >
      <HStack gap={3}>
        <Text whiteSpace="nowrap" fontSize="sm" fontWeight="medium">
          {selectedCount} selected
        </Text>
        <Button
          size="sm"
          variant="outline"
          colorPalette="orange"
          onClick={onArchive}
        >
          <Archive size={14} />
          Archive
        </Button>
      </HStack>
    </Box>
  );
}

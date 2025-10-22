import { Badge, Box, Circle, HStack, Text } from "@chakra-ui/react";
import { X } from "react-feather";

interface PromptBrowserTabProps {
  title?: string | null;
  version?: number;
  hasUnsavedChanges?: boolean;
  onClose?: () => void;
  dimmed?: boolean;
}

export function PromptBrowserTab({
  title,
  version,
  hasUnsavedChanges,
  onClose,
  dimmed,
}: PromptBrowserTabProps) {
  return (
    <HStack gap={2} height="full">
      <HStack>
        <Text textOverflow="ellipsis" whiteSpace="nowrap" overflow="hidden">
          {title ?? "Untitled"}
        </Text>
        {hasUnsavedChanges ? (
          <Box>
            <Circle size="10px" bg="orange.400" color="gray.50" />
          </Box>
        ) : version != null ? (
          <Badge colorPalette="gray" fontSize="sm" textTransform="none">
            v{version}
          </Badge>
        ) : null}
      </HStack>
      <Box
        role="button"
        borderRadius="3px"
        transition="all 0.1s ease-in-out"
        padding={0.5}
        opacity={dimmed ? 0.25 : 1}
        _hover={{ opacity: 1 }}
        onPointerDown={(e) => {
          // Stop the event from bubbling up to drag listeners
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
          onClose?.();
        }}
      >
        <X width="18px" />
      </Box>
    </HStack>
  );
}

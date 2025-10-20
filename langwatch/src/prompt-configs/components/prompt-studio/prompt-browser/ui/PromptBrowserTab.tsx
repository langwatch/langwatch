import { Badge, Box, Circle, HStack } from "@chakra-ui/react";
import { X } from "react-feather";

interface PromptBrowserTabProps {
  title?: string;
  version?: number;
  hasUnsavedChanges?: boolean;
  onClose?: () => void;
}

export function PromptBrowserTab({
  title,
  version,
  hasUnsavedChanges,
  onClose,
}: PromptBrowserTabProps) {
  return (
    <HStack gap={2}>
      <HStack>
        <Box>{title ?? "Untitled"}</Box>
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

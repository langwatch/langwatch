import { Badge, Box, Circle, HStack } from "@chakra-ui/react";
import { BrowserLikeTabs, type BrowserLikeTabProps } from "./BrowserLikeTabs";

interface PromptBrowserTabProps extends Omit<BrowserLikeTabProps, "children"> {
  version: number;
  hasUnsavedChanges?: boolean;
}

/**
 * Custom tab component for the prompt browser
 */
export function PromptBrowserTab({
  value,
  version,
  title,
  hasUnsavedChanges,
}: PromptBrowserTabProps) {
  return (
    <BrowserLikeTabs.Tab
      value={value}
      title={
        <HStack>
          <Box>{title}</Box>
          {hasUnsavedChanges ? (
            <Box>
              <Circle size="10px" bg="orange.400" color="gray.50" />
            </Box>
          ) : (
            <Badge colorPalette="gray" fontSize="sm" textTransform="none">
              v{version}
            </Badge>
          )}
        </HStack>
      }
    >
      PromptBrowserTab
    </BrowserLikeTabs.Tab>
  );
}

import { Box, Circle, HStack, type StackProps, Text } from "@chakra-ui/react";
import { LuX } from "react-icons/lu";
import { VersionBadge } from "~/prompts/components/ui/VersionBadge";
import { withController } from "~/utils/withControllerHOC";
import { usePromptBrowserTabController } from "./usePromptBrowserTabController";

interface PromptBrowserTabProps extends StackProps {
  dimmed?: boolean;
}

type PromptBrowserTabControllerProps = ReturnType<
  typeof usePromptBrowserTabController
>;

/**
 * PromptBrowserTabView
 * Single Responsibility: Renders a browser tab with title, version badge, organization badge, unsaved changes indicator, and close button.
 */
function PromptBrowserTabView({
  tab,
  hasUnsavedChanges,
  dimmed,
  handleClose,
  latestVersion,
  isOutdated,
  handleUpgrade,
  showVersionBadge,
  ...rest
}: PromptBrowserTabProps & PromptBrowserTabControllerProps) {
  if (!tab) return null;
  const meta = tab.data.meta;

  return (
    // `minWidth={0}` on every flex ancestor of the title, or the title's
    // intrinsic width wins and the tab refuses to shrink. Ellipsis only
    // engages once the chain down to the Text can actually be squeezed.
    <HStack gap={2} height="full" width="full" minWidth={0} {...rest}>
      <HStack gap={2} minWidth={0} flex="1 1 0">
        <Text
          textOverflow="ellipsis"
          whiteSpace="nowrap"
          overflow="hidden"
          minWidth={0}
          title={meta.title ?? "New Prompt"}
        >
          {meta.title ?? "New Prompt"}
        </Text>
        {hasUnsavedChanges && (
          <Box flexShrink={0}>
            <Circle size="10px" bg="orange.solid" />
          </Box>
        )}
        {showVersionBadge && meta.versionNumber != null && (
          <Box flexShrink={0}>
            <VersionBadge
              version={meta.versionNumber}
              latestVersion={latestVersion}
              onUpgrade={isOutdated ? handleUpgrade : undefined}
            />
          </Box>
        )}
      </HStack>
      <Box
        role="button"
        borderRadius="3px"
        transition="all 0.1s ease-in-out"
        opacity={dimmed ? 0.25 : 1}
        flexShrink={0}
        _hover={{ opacity: 1 }}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        onClick={handleClose}
        marginRight={-1}
      >
        <LuX width="18px" />
      </Box>
    </HStack>
  );
}

export const PromptBrowserTab = withController(
  PromptBrowserTabView,
  usePromptBrowserTabController,
);

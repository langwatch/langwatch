import { Box, Circle, HStack, type StackProps, Text } from "@chakra-ui/react";
import { useState } from "react";
import { LuX } from "react-icons/lu";
import { VersionBadge } from "~/prompts/components/ui/VersionBadge";
import { getDisplayHandle } from "~/prompts/utils/promptHandle";
import { withController } from "~/utils/withControllerHOC";
import { usePromptBrowserTabController } from "./usePromptBrowserTabController";

interface PromptBrowserTabProps extends StackProps {
  dimmed?: boolean;
  /** The tab the pane is showing. It always keeps its close button. */
  isActive?: boolean;
  /** The strip has run out of room, so every tab sits at its narrow floor. */
  isCrowded?: boolean;
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
  isActive,
  isCrowded,
  handleClose,
  latestVersion,
  isOutdated,
  handleUpgrade,
  showVersionBadge,
  ...rest
}: PromptBrowserTabProps & PromptBrowserTabControllerProps) {
  // Tracked in React rather than left to CSS `:hover`, because whether the
  // close button exists changes the width left for the title. A rule about
  // what is rendered belongs in render, where a test can see it.
  const [isHovered, setIsHovered] = useState(false);

  if (!tab) return null;
  const meta = tab.data.meta;

  // At the floor a tab has room for the name or the close button, not both.
  // The name is what tells two tabs apart, so it wins until the pointer
  // arrives. The active tab is the one most likely to be closed, and it is
  // never in doubt about which prompt it is.
  const showsCloseButton = !isCrowded || isActive || isHovered;

  return (
    // `minWidth={0}` on every flex ancestor of the title, or the title's
    // intrinsic width wins and the tab refuses to shrink. Ellipsis only
    // engages once the chain down to the Text can actually be squeezed.
    <HStack
      gap={2}
      height="full"
      width="full"
      minWidth={0}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      {...rest}
    >
      <HStack gap={2} minWidth={0} flex="1 1 0">
        {/* A tab is narrow, so it spends its width on the prompt's own name.
            The folder it lives in — the `onboarding/` of `onboarding/welcome` —
            would otherwise be all a shrunk tab could show. The full handle
            stays on hover, and the switcher rows carry the folder. */}
        <Text
          textOverflow="ellipsis"
          whiteSpace="nowrap"
          overflow="hidden"
          minWidth={0}
          title={meta.title ?? "New Prompt"}
        >
          {getDisplayHandle(meta.title)}
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
      {showsCloseButton && (
        <Box
          role="button"
          aria-label={`Close ${getDisplayHandle(meta.title)}`}
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
      )}
    </HStack>
  );
}

export const PromptBrowserTab = withController(
  PromptBrowserTabView,
  usePromptBrowserTabController,
);

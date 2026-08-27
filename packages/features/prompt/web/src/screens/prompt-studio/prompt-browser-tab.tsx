import { Box, Circle, HStack, type StackProps, Text } from "@chakra-ui/react";
import { useState, type MouseEvent } from "react";
import { LuX } from "react-icons/lu";
import { getDisplayHandle } from "../../surfaces/prompt-reference";
import { VersionBadge } from "../../surfaces/prompt-version";

export interface PromptBrowserTabProps extends StackProps {
  title: string;
  hasUnsavedChanges: boolean;
  versionNumber?: number;
  latestVersion?: number;
  isOutdated: boolean;
  showVersionBadge: boolean;
  onClose: (event: MouseEvent) => void;
  onUpgrade: () => void;
  dimmed?: boolean;
  /** The tab the pane is showing. It always keeps its close button. */
  isActive?: boolean;
  /** The strip has run out of room, so every tab sits at its narrow floor. */
  isCrowded?: boolean;
}

/** Presentation-only browser tab. App state, persistence, and upgrade actions
 * are supplied by the caller. */
export function PromptBrowserTab({
  title,
  hasUnsavedChanges,
  versionNumber,
  latestVersion,
  isOutdated,
  showVersionBadge,
  onClose,
  onUpgrade,
  dimmed,
  isActive,
  isCrowded,
  ...rest
}: PromptBrowserTabProps) {
  const [isHovered, setIsHovered] = useState(false);
  const name = getDisplayHandle(title);
  const showsCloseButton = !isCrowded || isActive || isHovered;

  return (
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
        <Text
          textOverflow="ellipsis"
          whiteSpace="nowrap"
          overflow="hidden"
          minWidth={0}
          title={title}
        >
          {name}
        </Text>
        {hasUnsavedChanges && (
          <Box flexShrink={0}>
            <Circle size="10px" bg="orange.solid" />
          </Box>
        )}
        {showVersionBadge && versionNumber != null && (
          <Box flexShrink={0}>
            <VersionBadge
              version={versionNumber}
              latestVersion={latestVersion}
              onUpgrade={isOutdated ? onUpgrade : void 0}
            />
          </Box>
        )}
      </HStack>
      {showsCloseButton && (
        <Box
          role="button"
          aria-label={`Close ${name}`}
          borderRadius="3px"
          transition="all 0.1s ease-in-out"
          opacity={dimmed ? 0.25 : 1}
          flexShrink={0}
          _hover={{ opacity: 1 }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onClose}
          marginRight={-1}
        >
          <LuX width="18px" />
        </Box>
      )}
    </HStack>
  );
}

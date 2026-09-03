import { Circle, HStack, Text } from "@chakra-ui/react";
import { PromptTabSwitcher as PromptTabSwitcherView } from "../studio-internals";
import type { RefObject } from "react";
import { getDisplayHandle, getPromptFolder } from "../../../surfaces/prompt-reference";
import { usePromptTabSummary } from "./tab/use-prompt-tab-summary";

interface PromptTabSwitcherProps {
  tabIds: string[];
  activeTabId?: string;
  onSelect: (tabId: string) => void;
  scrollerRef: RefObject<HTMLDivElement | null>;
  isStripOverflowing: boolean;
}

/** App adapter that supplies tab summaries to the portable switcher shell. */
export function PromptTabSwitcher(props: PromptTabSwitcherProps) {
  return (
    <PromptTabSwitcherView {...props}>
      {(tabId, isActive) => <PromptTabSwitcherRow tabId={tabId} isActive={isActive} />}
    </PromptTabSwitcherView>
  );
}

function PromptTabSwitcherRow({ tabId, isActive }: { tabId: string; isActive: boolean }) {
  const { title, hasUnsavedChanges, versionNumber, showVersionBadge } = usePromptTabSummary(tabId);
  const folder = getPromptFolder(title);
  const name = getDisplayHandle(title);

  return (
    <HStack
      width="full"
      minWidth={0}
      aria-current={isActive ? "true" : void 0}
      fontWeight={isActive ? "semibold" : void 0}
    >
      <Text textOverflow="ellipsis" whiteSpace="nowrap" overflow="hidden" minWidth={0}>
        {folder && (
          <Text as="span" color="fg.subtle">
            {folder}/
          </Text>
        )}
        {name}
      </Text>
      {hasUnsavedChanges && (
        <Circle data-testid="unsaved-indicator" size="8px" bg="orange.solid" flexShrink={0} />
      )}
      {showVersionBadge && versionNumber != null && (
        <Text fontSize="xs" color="fg.muted" flexShrink={0}>
          v{versionNumber}
        </Text>
      )}
    </HStack>
  );
}

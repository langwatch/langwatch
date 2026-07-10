import { Button, Circle, HStack, Text } from "@chakra-ui/react";
import type React from "react";
import { LuChevronDown } from "react-icons/lu";
import {
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
} from "~/components/ui/menu";
import { usePromptTabSummary } from "../tab/usePromptTabSummary";

interface PromptTabSwitcherProps {
  /** Tabs open in this pane, in strip order. */
  tabIds: string[];
  activeTabId?: string;
  /** Activate a tab. Never called for the tab that is already active. */
  onSelect: (tabId: string) => void;
  /** The pane's horizontally scrolling tab strip, used to reveal a chosen tab. */
  scrollerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * PromptTabSwitcher
 *
 * Single Responsibility: List every prompt open in this pane and let the user
 * jump to one, including the tabs that have scrolled out of the strip.
 *
 * The strip keeps scrolling and keeps every tab mounted — nothing is hidden —
 * so drag-to-reorder continues to work on tabs the switcher also lists.
 * A single open prompt needs no switcher, so none is rendered.
 */
export function PromptTabSwitcher({
  tabIds,
  activeTabId,
  onSelect,
  scrollerRef,
}: PromptTabSwitcherProps) {
  if (tabIds.length <= 1) return null;

  /**
   * Reveal the chosen tab in the strip. Looked up by attribute rather than a
   * CSS selector so a tab id never has to be escaped.
   */
  const scrollTabIntoView = (tabId: string) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const tab = Array.from(
      scroller.querySelectorAll<HTMLElement>("[data-tab-id]"),
    ).find((el) => el.getAttribute("data-tab-id") === tabId);
    tab?.scrollIntoView({
      behavior: "smooth",
      inline: "nearest",
      block: "nearest",
    });
  };

  const handleSelect = (tabId: string) => {
    // Re-activating the active tab would churn the store for no gain. Still
    // reveal it, since the user asked to be taken to it.
    if (tabId !== activeTabId) onSelect(tabId);
    scrollTabIntoView(tabId);
  };

  return (
    <MenuRoot lazyMount unmountOnExit>
      <MenuTrigger asChild>
        <Button
          size="xs"
          variant="ghost"
          flexShrink={0}
          gap={1}
          paddingX={2}
          color="fg.muted"
          aria-label={`Show ${tabIds.length} open prompts`}
        >
          <Text fontSize="xs" fontWeight="medium">
            {tabIds.length}
          </Text>
          <LuChevronDown size={12} />
        </Button>
      </MenuTrigger>
      <MenuContent minWidth="240px">
        {tabIds.map((tabId) => (
          <PromptTabSwitcherRow
            key={tabId}
            tabId={tabId}
            isActive={tabId === activeTabId}
            onSelect={handleSelect}
          />
        ))}
      </MenuContent>
    </MenuRoot>
  );
}

/**
 * PromptTabSwitcherRow
 *
 * Single Responsibility: Render one open prompt as a navigation target,
 * mirroring the title, unsaved dot and version its tab shows.
 *
 * Deliberately offers no close or upgrade control: those belong on the tab,
 * so that choosing a row can only ever navigate.
 */
function PromptTabSwitcherRow({
  tabId,
  isActive,
  onSelect,
}: {
  tabId: string;
  isActive: boolean;
  onSelect: (tabId: string) => void;
}) {
  const { title, hasUnsavedChanges, versionNumber, showVersionBadge } =
    usePromptTabSummary(tabId);

  return (
    <MenuItem
      value={tabId}
      onClick={() => onSelect(tabId)}
      aria-current={isActive ? "true" : undefined}
      fontWeight={isActive ? "semibold" : undefined}
    >
      <HStack gap={2} width="full">
        <Text textOverflow="ellipsis" whiteSpace="nowrap" overflow="hidden">
          {title}
        </Text>
        {hasUnsavedChanges && (
          <Circle
            data-testid="unsaved-indicator"
            size="8px"
            bg="orange.solid"
            flexShrink={0}
          />
        )}
        {showVersionBadge && versionNumber != null && (
          <Text fontSize="xs" color="fg.muted" flexShrink={0}>
            v{versionNumber}
          </Text>
        )}
      </HStack>
    </MenuItem>
  );
}

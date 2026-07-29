import { Button, Circle, HStack, Text } from "@chakra-ui/react";
import type React from "react";
import { LuChevronDown } from "react-icons/lu";
import {
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
} from "~/components/ui/menu";
import { getDisplayHandle, getPromptFolder } from "~/prompts/utils/promptHandle";
import { usePromptTabSummary } from "../tab/usePromptTabSummary";

interface PromptTabSwitcherProps {
  /** Tabs open in this pane, in strip order. */
  tabIds: string[];
  activeTabId?: string;
  /** Activate a tab. Never called for the tab that is already active. */
  onSelect: (tabId: string) => void;
  /** The pane's horizontally scrolling tab strip, used to reveal a chosen tab. */
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  /** Whether the strip has run out of room even with its tabs at their floor. */
  isStripOverflowing: boolean;
}

/**
 * PromptTabSwitcher
 *
 * Single Responsibility: List every prompt open in this pane and let the user
 * jump to one, including the tabs that have scrolled out of the strip.
 *
 * Shown only once the strip actually overflows. Tabs shrink to share the strip
 * before that point, so while they all fit the switcher would be a dropdown
 * listing things already on screen.
 *
 * The strip keeps scrolling and keeps every tab mounted — nothing is hidden —
 * so drag-to-reorder continues to work on tabs the switcher also lists.
 */
export function PromptTabSwitcher({
  tabIds,
  activeTabId,
  onSelect,
  scrollerRef,
  isStripOverflowing,
}: PromptTabSwitcherProps) {
  if (!isStripOverflowing || tabIds.length <= 1) return null;

  /**
   * Reveal the chosen tab in the strip. Looked up by attribute rather than a
   * CSS selector so a tab id never has to be escaped.
   */
  const scrollTabIntoView = (tabId: string) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const tab = Array.from(
      scroller.querySelectorAll<HTMLElement>("[data-tab-strip-id]"),
    ).find((el) => el.getAttribute("data-tab-strip-id") === tabId);
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
          // `plain` keeps it a quiet count rather than a competing button: no
          // background or border until hovered. It sits in the tab row, so it
          // must never wrap out of it or grow the row's height.
          size="2xs"
          variant="plain"
          flexShrink={0}
          alignSelf="center"
          height="24px"
          minWidth="auto"
          gap={0.5}
          paddingX={1}
          borderRadius="sm"
          whiteSpace="nowrap"
          color="fg.subtle"
          _hover={{ background: "bg.subtle", color: "fg" }}
          _focusVisible={{ outline: "none", background: "bg.subtle" }}
          aria-label={`Show ${tabIds.length} open prompts`}
        >
          <Text fontSize="xs" fontWeight="medium">
            {tabIds.length}
          </Text>
          <LuChevronDown size={11} />
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
  const folder = getPromptFolder(title);
  const name = getDisplayHandle(title);

  return (
    <MenuItem
      value={tabId}
      onClick={() => onSelect(tabId)}
      aria-current={isActive ? "true" : undefined}
      fontWeight={isActive ? "semibold" : undefined}
    >
      <HStack gap={2} width="full" minWidth={0}>
        <Text
          textOverflow="ellipsis"
          whiteSpace="nowrap"
          overflow="hidden"
          minWidth={0}
        >
          {/* The row has room the tab does not, so it carries the folder. It is
              what tells two prompts both named "welcome" apart. */}
          {folder && (
            <Text as="span" color="fg.subtle">
              {folder}/
            </Text>
          )}
          {name}
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

import { Button, Menu, Text } from "@chakra-ui/react";
import type { ReactNode, RefObject } from "react";
import { LuChevronDown } from "react-icons/lu";

export interface PromptTabSwitcherProps {
  tabIds: string[];
  activeTabId?: string;
  onSelect: (tabId: string) => void;
  scrollerRef: RefObject<HTMLDivElement | null>;
  isStripOverflowing: boolean;
  children: (tabId: string, isActive: boolean) => ReactNode;
}

/** Browser-safe selector for Prompt tabs that have scrolled out of view. */
export function PromptTabSwitcher({
  tabIds,
  activeTabId,
  onSelect,
  scrollerRef,
  isStripOverflowing,
  children,
}: PromptTabSwitcherProps) {
  if (!isStripOverflowing || tabIds.length <= 1) return null;

  function scrollTabIntoView(tabId: string) {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    Array.from(scroller.querySelectorAll<HTMLElement>("[data-tab-strip-id]"))
      .find((element) => element.getAttribute("data-tab-strip-id") === tabId)
      ?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
  }

  function handleSelect(tabId: string) {
    if (tabId !== activeTabId) onSelect(tabId);
    scrollTabIntoView(tabId);
  }

  return (
    <Menu.Root lazyMount unmountOnExit>
      <Menu.Trigger asChild>
        <Button
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
      </Menu.Trigger>
      <Menu.Positioner>
        <Menu.Content minWidth="240px" borderRadius="lg" background="bg.panel">
          {tabIds.map((tabId) => (
            <Menu.Item
              key={tabId}
              value={tabId}
              aria-current={tabId === activeTabId ? "true" : void 0}
              onClick={() => handleSelect(tabId)}
            >
              {children(tabId, tabId === activeTabId)}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Positioner>
    </Menu.Root>
  );
}

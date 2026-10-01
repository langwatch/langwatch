import { Popover } from "@langwatch/design-system/popover";
import { Box, HStack, Link, Text, VStack } from "@langwatch/design-system/primitives";
import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { MenuQueryHeader } from "../../menu-query-header.tsx";
import {
  TEMPLATE_SYNTAX_DOCS_URL,
  type TemplateLogicConstruct,
} from "../template-logic-constructs.ts";

// ============================================================================
// Types
// ============================================================================

type TemplateLogicMenuProps = {
  /** Whether the menu is open */
  isOpen: boolean;
  /** Position for the menu (absolute coordinates) */
  position: { top: number; left: number };
  /** Search query (text typed after {%) - controlled by parent */
  query: string;
  /** Callback to update query (when provided, shows editable search input) */
  onQueryChange?: (query: string) => void;
  /** Filtered constructs to display */
  filteredConstructs: TemplateLogicConstruct[];
  /** Current highlighted index - controlled by parent */
  highlightedIndex: number;
  /** Callback to update highlighted index */
  onHighlightChange: (index: number) => void;
  /** Whether navigation is via keyboard (to prevent hover conflicts) */
  isKeyboardNav?: boolean;
  /** Callback to update keyboard nav mode */
  onKeyboardNavChange?: (isKeyboard: boolean) => void;
  /** Callback when a construct is selected */
  onSelect: (construct: TemplateLogicConstruct) => void;
  /** Callback when menu should close */
  onClose: () => void;
  /** Ref to trigger element - clicks on this won't close the menu */
  triggerRef?: React.RefObject<HTMLElement | null>;
};

// ============================================================================
// Main Component
// ============================================================================

const MENU_WIDTH = 280;
const MENU_MAX_HEIGHT = 350;

export const TemplateLogicMenu = ({
  isOpen,
  position,
  query,
  onQueryChange,
  filteredConstructs,
  highlightedIndex,
  onHighlightChange,
  isKeyboardNav: isKeyboardNavProp,
  onKeyboardNavChange,
  onSelect,
  onClose,
  triggerRef,
}: TemplateLogicMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [localKeyboardNav, setLocalKeyboardNav] = useState(false);
  const isKeyboardNav = isKeyboardNavProp ?? localKeyboardNav;
  const setIsKeyboardNav = onKeyboardNavChange ?? setLocalKeyboardNav;

  // Handle click outside - close menu when clicking outside menu and trigger
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef?.current?.contains(target)) return;
      onClose();
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose, triggerRef]);

  // Focus search input when menu opens in editable mode
  useEffect(() => {
    if (isOpen && onQueryChange && searchInputRef.current) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 0);
    }
  }, [isOpen, onQueryChange]);

  // Handle selection
  const handleSelect = useCallback(
    (index: number) => {
      const construct = filteredConstructs[index];
      if (!construct) return;
      onSelect(construct);
    },
    [filteredConstructs, onSelect],
  );

  return (
    <Popover.Root
      open={isOpen}
      positioning={{
        getAnchorRect: () => ({
          x: position.left,
          y: position.top - 32,
          width: 0,
          height: 32,
        }),
        placement: "bottom-start",
        flip: true,
        slide: true,
      }}

      lazyMount
      unmountOnExit
    >
      <Popover.Content
        ref={menuRef}
        width={`${MENU_WIDTH}px`}
        maxHeight={`${MENU_MAX_HEIGHT}px`}
        background="bg.panel"
        borderRadius="8px"
        boxShadow="lg"
        border="1px solid"
        borderColor="border"
        overflow="hidden"
        padding={0}
        tabIndex={onQueryChange ? undefined : -1}
        onClick={(e) => e.stopPropagation()}
        data-testid="template-logic-menu"
      >
        <MenuQueryHeader
          query={query}
          onQueryChange={onQueryChange}
          inputRef={searchInputRef}
          readOnlyText={`{%${query ? ` ${query}` : ""}`}
          placeholder="Search constructs..."
          onMove={(delta) => {
            setIsKeyboardNav(true);
            onHighlightChange(
              delta > 0
                ? Math.min(highlightedIndex + 1, filteredConstructs.length - 1)
                : Math.max(highlightedIndex - 1, 0),
            );
          }}
          onEnter={() => handleSelect(highlightedIndex)}
          onEscape={onClose}
        />
        <Box maxHeight="240px" overflowY="auto">
          {filteredConstructs.length === 0 ? (
            <Box padding={3}>
              <Text fontSize="sm" color="fg.muted">
                No matching constructs
              </Text>
            </Box>
          ) : (
            <VStack align="stretch" gap={0} padding={1}>
              {filteredConstructs.map((construct, index) => (
                <ConstructOption
                  key={construct.keyword}
                  construct={construct}
                  isHighlighted={index === highlightedIndex}
                  onHover={() => {
                    if (isKeyboardNav || highlightedIndex !== index) {
                      setIsKeyboardNav(false);
                      onHighlightChange(index);
                    }
                  }}
                  onSelect={() => handleSelect(index)}
                />
              ))}
            </VStack>
          )}
        </Box>

        {/* Footer with docs link */}
        <Box padding={2} borderTop="1px solid" borderColor="border.muted" background="bg.subtle">
          <Link
            href={TEMPLATE_SYNTAX_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            fontSize="xs"
            color="fg.muted"
            display="flex"
            alignItems="center"
            gap={1}
            _hover={{ color: "blue.500" }}
          >
            Learn template syntax
            <ExternalLink size={10} />
          </Link>
        </Box>
      </Popover.Content>
    </Popover.Root>
  );
};

function ConstructOption({
  construct,
  isHighlighted,
  onHover,
  onSelect,
}: {
  construct: TemplateLogicConstruct;
  isHighlighted: boolean;
  onHover: () => void;
  onSelect: () => void;
}) {
  return (
    <HStack
      paddingX={3}
      paddingY={2}
      gap={2}
      cursor="pointer"
      borderRadius="4px"
      background={isHighlighted ? "blue.50" : undefined}
      onMouseMove={onHover}
      onClick={onSelect}
      data-testid={`logic-construct-${construct.keyword}`}
    >
      <Text fontSize="13px" fontFamily="mono" fontWeight="600" minWidth="60px">
        {construct.keyword}
      </Text>
      <Text fontSize="xs" color="fg.muted">
        {construct.description}
      </Text>
    </HStack>
  );
}

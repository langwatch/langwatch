/**
 * GroupByRowsMenu — the "Group rows by: X" trigger and its menu for the
 * comparison table (issue #4632).
 *
 * Rendered through a Portal rather than as an absolutely positioned
 * child so an `overflow: hidden` ancestor in BatchEvaluationResults
 * cannot clip it — the same pattern the chart's axis picker uses (see
 * ComparisonCharts.tsx).
 *
 * Every way out of the menu — Escape, Enter/Space on an option, a click
 * on an option, a click on the backdrop — goes through one `dismiss`,
 * so focus always returns to the trigger instead of being dropped on
 * the body for mouse users only.
 */

import { Box, Button, HStack, Portal, Text, VStack } from "@chakra-ui/react";
import { useCallback, useRef, useState } from "react";

const NO_GROUPING_LABEL = "No grouping";

type GroupByOption = {
  /** Metadata key to group on, or `null` for a flat table. */
  key: string | null;
  label: string;
};

type GroupByRowsMenuProps = {
  /** Metadata keys offered under the "No grouping" entry. */
  availableKeys: string[];
  /** The key currently applied, or `null` when the table is flat. */
  value: string | null;
  onChange: (key: string | null) => void;
};

export function GroupByRowsMenu({
  availableKeys,
  value,
  onChange,
}: GroupByRowsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const dismiss = useCallback(() => {
    setIsOpen(false);
    triggerRef.current?.focus();
  }, []);

  const toggle = useCallback(() => {
    if (isOpen) {
      dismiss();
      return;
    }
    setTriggerRect(triggerRef.current?.getBoundingClientRect() ?? null);
    setIsOpen(true);
  }, [isOpen, dismiss]);

  const select = useCallback(
    (key: string | null) => {
      onChange(key);
      dismiss();
    },
    [onChange, dismiss],
  );

  return (
    <HStack paddingX={2} paddingY={2} flexShrink={0}>
      <Box>
        <Button
          ref={triggerRef}
          size="xs"
          variant="outline"
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          data-testid="group-by-row-button"
        >
          Group rows by: {value ?? NO_GROUPING_LABEL}
        </Button>
        {isOpen && triggerRect && (
          <GroupByMenuPanel
            anchorRect={triggerRect}
            options={buildOptions(availableKeys)}
            value={value}
            onSelect={select}
            onDismiss={dismiss}
          />
        )}
      </Box>
    </HStack>
  );
}

const buildOptions = (availableKeys: string[]): GroupByOption[] => [
  { key: null, label: NO_GROUPING_LABEL },
  ...availableKeys.map((key) => ({ key, label: key })),
];

type GroupByMenuPanelProps = {
  anchorRect: DOMRect;
  options: GroupByOption[];
  value: string | null;
  onSelect: (key: string | null) => void;
  onDismiss: () => void;
};

function GroupByMenuPanel({
  anchorRect,
  options,
  value,
  onSelect,
  onDismiss,
}: GroupByMenuPanelProps) {
  return (
    <Portal>
      <Box
        position="fixed"
        inset={0}
        zIndex={1000}
        onClick={onDismiss}
        data-testid="group-by-row-backdrop"
      />
      <Box
        position="fixed"
        top={`${anchorRect.bottom + 4}px`}
        left={`${anchorRect.left}px`}
        bg="bg.panel"
        border="1px solid"
        borderColor="border"
        borderRadius="md"
        boxShadow="md"
        zIndex={1001}
        minWidth="180px"
        padding={2}
        style={{
          maxHeight: `calc(100vh - ${anchorRect.bottom + 16}px)`,
          overflowY: "auto",
        }}
        data-testid="group-by-row-dropdown"
        role="menu"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onDismiss();
          }
        }}
      >
        <VStack align="stretch" gap={1}>
          {options.map((option) => (
            <GroupByMenuItem
              key={option.key ?? "none"}
              option={option}
              isSelected={option.key === value}
              onSelect={onSelect}
            />
          ))}
        </VStack>
      </Box>
    </Portal>
  );
}

type GroupByMenuItemProps = {
  option: GroupByOption;
  isSelected: boolean;
  onSelect: (key: string | null) => void;
};

function GroupByMenuItem({
  option,
  isSelected,
  onSelect,
}: GroupByMenuItemProps) {
  const activate = () => onSelect(option.key);

  return (
    <HStack
      padding={1}
      borderRadius="sm"
      cursor="pointer"
      bg={isSelected ? "blue.subtle" : "transparent"}
      _hover={{ bg: isSelected ? "blue.muted" : "bg.subtle" }}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      }}
      role="menuitem"
      tabIndex={0}
      data-testid={`group-by-row-option-${option.key ?? "none"}`}
    >
      <Text
        fontSize="sm"
        fontWeight={isSelected ? "medium" : "normal"}
        color={isSelected ? "blue.fg" : "inherit"}
      >
        {option.label}
      </Text>
    </HStack>
  );
}

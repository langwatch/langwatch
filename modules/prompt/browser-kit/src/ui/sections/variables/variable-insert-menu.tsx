import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { Popover } from "@langwatch/design-system/popover";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MenuQueryHeader } from "./menu-query-header.tsx";
import type {
  AvailableSource,
  FieldType,
  RenderSourceIcon,
  SourceType,
} from "./variable-mapping-input.tsx";
import { VariableTypeBadge, VariableTypeIcon } from "./variable-type/index.ts";

// ============================================================================
// Types
// ============================================================================

export type SelectedField = {
  sourceId: string;
  sourceName: string;
  sourceType: SourceType;
  fieldName: string;
  fieldType: FieldType;
};

type VariableInsertMenuProps = {
  /** Draws a source's icon; the consumer owns the icon set. */
  renderSourceIcon?: RenderSourceIcon;
  /** Whether the menu is open */
  isOpen: boolean;
  /** Position for the menu (absolute coordinates) */
  position: { top: number; left: number };
  /** Available sources to choose from */
  availableSources: AvailableSource[];
  /** Search query (text typed after {{) - controlled by parent */
  query: string;
  /** Callback to update query (when provided, shows editable search input) */
  onQueryChange?: (query: string) => void;
  /** Current highlighted index - controlled by parent */
  highlightedIndex: number;
  /** Callback to update highlighted index */
  onHighlightChange: (index: number) => void;
  /** Whether navigation is via keyboard (to prevent hover conflicts) */
  isKeyboardNav?: boolean;
  /** Callback to update keyboard nav mode */
  onKeyboardNavChange?: (isKeyboard: boolean) => void;
  /** Callback when a field is selected */
  onSelect: (field: SelectedField) => void;
  /** Callback when "create new variable" is selected */
  onCreateVariable?: (name: string) => void;
  /** Callback when menu should close */
  onClose: () => void;
  /** Expected type for type mismatch warnings */
  expectedType?: string;
  /** Ref to trigger element - clicks on this won't close the menu */
  triggerRef?: React.RefObject<HTMLElement | null>;
};

// ============================================================================
// Source Type Icon
// ============================================================================

// ============================================================================
// Main Component
// ============================================================================

// Menu dimensions
const MENU_WIDTH = 300;
const MENU_MAX_HEIGHT = 350;

export const VariableInsertMenu = ({
  isOpen,
  position,
  availableSources,
  query,
  onQueryChange,
  highlightedIndex,
  onHighlightChange,
  isKeyboardNav: isKeyboardNavProp,
  onKeyboardNavChange,
  onSelect,
  onCreateVariable,
  onClose,
  triggerRef,
  renderSourceIcon,
}: VariableInsertMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Track if navigation is from keyboard (to avoid hover conflicts)
  // Use prop if provided, otherwise use local state
  const [localKeyboardNav, setLocalKeyboardNav] = useState(false);
  const isKeyboardNav = isKeyboardNavProp ?? localKeyboardNav;
  const setIsKeyboardNav = onKeyboardNavChange ?? setLocalKeyboardNav;

  // Handle click outside - close menu when clicking outside menu and trigger
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      // Ignore clicks inside the menu
      if (menuRef.current?.contains(target)) return;
      // Ignore clicks on the trigger element (e.g., Add Variable button)
      if (triggerRef?.current?.contains(target)) return;
      onClose();
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose, triggerRef]);

  // Focus search input when menu opens in editable mode
  useEffect(() => {
    if (isOpen && onQueryChange && searchInputRef.current) {
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 0);
    }
  }, [isOpen, onQueryChange]);

  // Filter fields based on query
  const filteredSources = useMemo(
    () =>
      availableSources
        .map((source) => ({
          ...source,
          fields: source.fields.filter((field) =>
            field.name.toLowerCase().includes(query.toLowerCase()),
          ),
        }))
        .filter((source) => source.fields.length > 0),
    [availableSources, query],
  );

  // Normalize query for variable creation
  const normalizedQuery = query.trim().replace(/ /g, "_").toLowerCase();

  // Check if there's an exact match with the normalized query
  const hasExactMatch = useMemo(
    () =>
      filteredSources.some((source) =>
        source.fields.some((field) => field.name.toLowerCase() === normalizedQuery),
      ),
    [filteredSources, normalizedQuery],
  );

  // Show "Create variable" option when:
  // 1. There's a query to create
  // 2. No exact match exists (so we're not duplicating)
  // 3. onCreateVariable callback is provided
  const canCreateVariable = normalizedQuery && !hasExactMatch && onCreateVariable;

  // Flatten for keyboard navigation - fields FIRST, then "create" LAST
  const flattenedOptions = useMemo(() => {
    const options: (
      | {
          type: "field";
          source: AvailableSource;
          field: { name: string; type: FieldType };
        }
      | { type: "create"; name: string }
    )[] = [];

    // Add fields FIRST
    filteredSources.forEach((source) => {
      source.fields.forEach((field) => {
        options.push({ type: "field", source, field });
      });
    });

    // Add "create variable" option LAST
    if (canCreateVariable) {
      options.push({ type: "create", name: normalizedQuery });
    }

    return options;
  }, [filteredSources, canCreateVariable, normalizedQuery]);

  // The index for the "create" option (if it exists)
  const createOptionIndex = canCreateVariable ? flattenedOptions.length - 1 : -1;

  // Handle selection
  const handleSelect = useCallback(
    (index: number) => {
      const option = flattenedOptions[index];
      if (!option) return;

      if (option.type === "field") {
        onSelect({
          sourceId: option.source.id,
          sourceName: option.source.name,
          sourceType: option.source.type,
          fieldName: option.field.name,
          fieldType: option.field.type,
        });
      } else if (option.type === "create" && onCreateVariable) {
        onCreateVariable(option.name);
      }
    },
    [flattenedOptions, onSelect, onCreateVariable],
  );

  // Expose methods for parent to call on keyboard events
  const _selectHighlighted = useCallback(() => {
    handleSelect(highlightedIndex);
  }, [handleSelect, highlightedIndex]);

  const _moveHighlightUp = useCallback(() => {
    onHighlightChange(Math.max(highlightedIndex - 1, 0));
  }, [highlightedIndex, onHighlightChange]);

  const _moveHighlightDown = useCallback(() => {
    onHighlightChange(Math.min(highlightedIndex + 1, flattenedOptions.length - 1));
  }, [highlightedIndex, flattenedOptions.length, onHighlightChange]);

  return (
    <Popover.Root
      open={isOpen}
      // We handle click-outside manually to properly ignore the trigger element
      positioning={{
        // Use a virtual anchor at the given position
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
      // Only allow auto-focus when in editable mode (has search input)
      // When onQueryChange is NOT provided (readonly mode), don't steal focus

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
        // Prevent focus on container in readonly mode
        tabIndex={onQueryChange ? undefined : -1}
        // Prevent popover from closing when clicking inside
        onClick={(e) => e.stopPropagation()}
      >
        <MenuQueryHeader
          query={query}
          readOnlyText={`{{${query}`}
          placeholder="Search variables..."
          onQueryChange={onQueryChange}
          inputRef={searchInputRef}
          onMove={(delta) => {
            setIsKeyboardNav(true);
            onHighlightChange(
              delta > 0
                ? Math.min(highlightedIndex + 1, flattenedOptions.length - 1)
                : Math.max(highlightedIndex - 1, 0),
            );
          }}
          onEnter={() => handleSelect(highlightedIndex)}
          onEscape={onClose}
        />
        <MenuOptions
          filteredSources={filteredSources}
          optionCount={flattenedOptions.length}
          highlightedIndex={highlightedIndex}
          isKeyboardNav={isKeyboardNav}
          setIsKeyboardNav={setIsKeyboardNav}
          onHighlightChange={onHighlightChange}
          onSelectIndex={handleSelect}
          createOptionIndex={createOptionIndex}
          normalizedQuery={normalizedQuery}
          query={query}
          onCreateVariable={onCreateVariable}
          renderSourceIcon={renderSourceIcon}
        />
      </Popover.Content>
    </Popover.Root>
  );
};

type MenuOptionsProps = {
  filteredSources: AvailableSource[];
  optionCount: number;
  highlightedIndex: number;
  isKeyboardNav: boolean;
  setIsKeyboardNav: (value: boolean) => void;
  onHighlightChange: (index: number) => void;
  onSelectIndex: (index: number) => void;
  createOptionIndex: number;
  normalizedQuery: string;
  query: string;
  onCreateVariable?: (name: string) => void;
  renderSourceIcon?: RenderSourceIcon;
};

function MenuOptions(props: MenuOptionsProps) {
  const { filteredSources, optionCount, query, onCreateVariable } = props;
  if (optionCount === 0) {
    return (
      <Box maxHeight="280px" overflowY="auto">
        <Box padding={3}>
          <Text fontSize="sm" color="fg.muted">
            No matching fields found
          </Text>
          {onCreateVariable && !query && (
            <Text fontSize="xs" color="fg.subtle" marginTop={1}>
              Type a name to create a new variable
            </Text>
          )}
        </Box>
      </Box>
    );
  }
  const firstIndexOf = filteredSources.map((_, sourceIndex) =>
    filteredSources.slice(0, sourceIndex).reduce((sum, source) => sum + source.fields.length, 0),
  );
  return (
    <Box maxHeight="280px" overflowY="auto">
      <VStack align="stretch" gap={0} padding={1}>
        {filteredSources.map((source, sourceIndex) => (
          <MenuSourceGroup
            key={source.id}
            {...props}
            source={source}
            sourceIndex={sourceIndex}
            firstIndex={firstIndexOf[sourceIndex] ?? 0}
          />
        ))}
        <MenuCreateOption {...props} />
      </VStack>
    </Box>
  );
}

function highlightOnMove({
  optionIndex,
  highlightedIndex,
  isKeyboardNav,
  setIsKeyboardNav,
  onHighlightChange,
}: Pick<
  MenuOptionsProps,
  "highlightedIndex" | "isKeyboardNav" | "setIsKeyboardNav" | "onHighlightChange"
> & {
  optionIndex: number;
}): void {
  if (isKeyboardNav || highlightedIndex !== optionIndex) {
    setIsKeyboardNav(false);
    onHighlightChange(optionIndex);
  }
}

function MenuSourceGroup({
  source,
  sourceIndex,
  firstIndex,
  renderSourceIcon,
  onSelectIndex,
  ...highlight
}: MenuOptionsProps & { source: AvailableSource; sourceIndex: number; firstIndex: number }) {
  return (
    <Box>
      <HStack
        paddingX={2}
        paddingY={1}
        gap={2}
        background="bg.subtle"
        borderRadius="4px"
        marginBottom={1}
        marginTop={sourceIndex > 0 ? 2 : 0}
      >
        {renderSourceIcon?.(source.type)}
        <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
          {source.name}
        </Text>
      </HStack>
      {source.fields.map((field, fieldIndex) => {
        const optionIndex = firstIndex + fieldIndex;
        return (
          <HStack
            key={`${source.id}-${field.name}`}
            paddingX={3}
            paddingY={2}
            gap={2}
            cursor="pointer"
            borderRadius="4px"
            background={optionIndex === highlight.highlightedIndex ? "blue.50" : undefined}
            onMouseMove={() => highlightOnMove({ ...highlight, optionIndex })}
            onClick={() => onSelectIndex(optionIndex)}
          >
            <VariableTypeIcon type={field.type} size={12} />
            <Text fontSize="13px" fontFamily="mono" flex={1}>
              {field.name}
            </Text>
            <VariableTypeBadge type={field.type} size="xs" />
          </HStack>
        );
      })}
    </Box>
  );
}

function MenuCreateOption({
  createOptionIndex,
  normalizedQuery,
  onCreateVariable,
  filteredSources,
  ...highlight
}: MenuOptionsProps) {
  if (createOptionIndex < 0) return null;
  return (
    <HStack
      paddingX={3}
      paddingY={2}
      gap={2}
      cursor="pointer"
      borderRadius="4px"
      background={highlight.highlightedIndex === createOptionIndex ? "blue.50" : undefined}
      onMouseMove={() => highlightOnMove({ ...highlight, optionIndex: createOptionIndex })}
      borderTop="1px solid"
      borderColor="border.muted"
      marginTop={filteredSources.length > 0 ? 2 : 0}
      onClick={() => onCreateVariable?.(normalizedQuery)}
    >
      <Plus size={12} color="var(--chakra-colors-blue-500)" />
      <Text fontSize="13px" color="blue.600">
        Create variable "{`{{${normalizedQuery}}}`}"
      </Text>
    </HStack>
  );
}

// Export helper to get option count for parent component
export const getMenuOptionCount = (
  availableSources: AvailableSource[],
  query: string,
  canCreate: boolean,
): number => {
  const normalizedQuery = query.trim().replace(/ /g, "_").toLowerCase();
  let count = 0;

  availableSources.forEach((source) => {
    source.fields.forEach((field) => {
      const isMatch = field.name.toLowerCase().includes(query.toLowerCase());
      if (isMatch) count++;
    });
  });

  // Check for exact match
  const hasExactMatch = availableSources.some((source) =>
    source.fields.some((field) => field.name.toLowerCase() === normalizedQuery),
  );

  if (canCreate && normalizedQuery && !hasExactMatch) {
    count++;
  }

  return count;
};

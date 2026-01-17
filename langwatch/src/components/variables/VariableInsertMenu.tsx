import { Box, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { Database, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ColorfulBlockIcon,
  ComponentIcon,
} from "~/optimization_studio/components/ColorfulBlockIcons";
import type { ComponentType } from "~/optimization_studio/types/dsl";
import {
  VariableTypeBadge,
  VariableTypeIcon,
} from "~/prompts/components/ui/VariableTypeIcon";
import { Popover } from "../ui/popover";
import type {
  AvailableSource,
  FieldType,
  SourceType,
} from "./VariableMappingInput";

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

const SourceTypeIconSmall = ({ type }: { type: SourceType }) => {
  if (type === "dataset") {
    return (
      <ColorfulBlockIcon
        color="blue.400"
        size="xs"
        icon={<Database size={12} />}
      />
    );
  }
  return <ComponentIcon type={type as ComponentType} size="xs" />;
};

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
  expectedType,
  triggerRef,
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
        source.fields.some(
          (field) => field.name.toLowerCase() === normalizedQuery,
        ),
      ),
    [filteredSources, normalizedQuery],
  );

  // Show "Create variable" option when:
  // 1. There's a query to create
  // 2. No exact match exists (so we're not duplicating)
  // 3. onCreateVariable callback is provided
  const canCreateVariable =
    normalizedQuery && !hasExactMatch && onCreateVariable;

  // Flatten for keyboard navigation - fields FIRST, then "create" LAST
  const flattenedOptions = useMemo(() => {
    const options: Array<
      | {
          type: "field";
          source: AvailableSource;
          field: { name: string; type: FieldType };
        }
      | { type: "create"; name: string }
    > = [];

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
  const createOptionIndex = canCreateVariable
    ? flattenedOptions.length - 1
    : -1;

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
    onHighlightChange(
      Math.min(highlightedIndex + 1, flattenedOptions.length - 1),
    );
  }, [highlightedIndex, flattenedOptions.length, onHighlightChange]);

  // Attach keyboard handlers to parent (via ref or expose)
  // Actually, the parent will handle keyboard events and call these

  // Track current field index for highlighting
  let currentFieldIndex = 0;

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
      autoFocus={!!onQueryChange}
      lazyMount
      unmountOnExit
    >
      <Popover.Content
        ref={menuRef}
        width={`${MENU_WIDTH}px`}
        maxHeight={`${MENU_MAX_HEIGHT}px`}
        background="white"
        borderRadius="8px"
        boxShadow="lg"
        border="1px solid"
        borderColor="gray.200"
        overflow="hidden"
        padding={0}
        // Prevent focus on container in readonly mode
        tabIndex={onQueryChange ? undefined : -1}
        // Prevent popover from closing when clicking inside
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input (editable) or Query display (readonly) */}
        {onQueryChange ? (
          <Box padding={2} borderBottom="1px solid" borderColor="gray.100">
            <Input
              ref={searchInputRef}
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setIsKeyboardNav(true);
                  onHighlightChange(
                    Math.min(highlightedIndex + 1, flattenedOptions.length - 1),
                  );
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setIsKeyboardNav(true);
                  onHighlightChange(Math.max(highlightedIndex - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  handleSelect(highlightedIndex);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  onClose();
                }
              }}
              placeholder="Search variables..."
              size="sm"
              variant="outline"
            />
          </Box>
        ) : (
          query && (
            <Box
              padding={2}
              borderBottom="1px solid"
              borderColor="gray.100"
              background="gray.50"
            >
              <Text fontSize="sm" color="gray.600" fontFamily="mono">
                {`{{${query}`}
              </Text>
            </Box>
          )
        )}

        {/* Options List */}
        <Box maxHeight="280px" overflowY="auto">
          {flattenedOptions.length === 0 ? (
            <Box padding={3}>
              <Text fontSize="sm" color="gray.500">
                No matching fields found
              </Text>
              {onCreateVariable && !query && (
                <Text fontSize="xs" color="gray.400" marginTop={1}>
                  Type a name to create a new variable
                </Text>
              )}
            </Box>
          ) : (
            <VStack align="stretch" gap={0} padding={1}>
              {filteredSources.map((source, sourceIndex) => (
                <Box key={source.id}>
                  {/* Source Header */}
                  <HStack
                    paddingX={2}
                    paddingY={1}
                    gap={2}
                    background="gray.50"
                    borderRadius="4px"
                    marginBottom={1}
                    marginTop={sourceIndex > 0 ? 2 : 0}
                  >
                    <SourceTypeIconSmall type={source.type} />
                    <Text fontSize="xs" fontWeight="semibold" color="gray.600">
                      {source.name}
                    </Text>
                  </HStack>

                  {/* Fields */}
                  {source.fields.map((field) => {
                    const optionIndex = currentFieldIndex++;
                    const isHighlighted = optionIndex === highlightedIndex;

                    return (
                      <HStack
                        key={`${source.id}-${field.name}`}
                        paddingX={3}
                        paddingY={2}
                        gap={2}
                        cursor="pointer"
                        borderRadius="4px"
                        background={isHighlighted ? "blue.50" : undefined}
                        onMouseMove={() => {
                          if (
                            isKeyboardNav ||
                            highlightedIndex !== optionIndex
                          ) {
                            setIsKeyboardNav(false);
                            onHighlightChange(optionIndex);
                          }
                        }}
                        onClick={() => handleSelect(optionIndex)}
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
              ))}

              {/* Create Variable Option - shown LAST */}
              {canCreateVariable && (
                <HStack
                  paddingX={3}
                  paddingY={2}
                  gap={2}
                  cursor="pointer"
                  borderRadius="4px"
                  background={
                    highlightedIndex === createOptionIndex
                      ? "blue.50"
                      : undefined
                  }
                  onMouseMove={() => {
                    if (
                      isKeyboardNav ||
                      highlightedIndex !== createOptionIndex
                    ) {
                      setIsKeyboardNav(false);
                      onHighlightChange(createOptionIndex);
                    }
                  }}
                  borderTop="1px solid"
                  borderColor="gray.100"
                  marginTop={filteredSources.length > 0 ? 2 : 0}
                  onClick={() => onCreateVariable?.(normalizedQuery)}
                >
                  <Plus size={12} color="var(--chakra-colors-blue-500)" />
                  <Text fontSize="13px" color="blue.600">
                    Create variable "{`{{${normalizedQuery}}}`}"
                  </Text>
                </HStack>
              )}
            </VStack>
          )}
        </Box>
      </Popover.Content>
    </Popover.Root>
  );
};

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
      if (field.name.toLowerCase().includes(query.toLowerCase())) {
        count++;
      }
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

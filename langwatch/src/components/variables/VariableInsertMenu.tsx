import {
  Box,
  HStack,
  Input,
  Portal,
  Text,
  VStack,
} from "@chakra-ui/react";
import { AlertTriangle, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ComponentIcon,
  ColorfulBlockIcon,
} from "~/optimization_studio/components/ColorfulBlockIcons";
import type { ComponentType } from "~/optimization_studio/types/dsl";
import {
  VariableTypeIcon,
  VariableTypeBadge,
} from "~/prompts/components/ui/VariableTypeIcon";
import type { AvailableSource, SourceType } from "./VariableMappingInput";

// ============================================================================
// Types
// ============================================================================

export type SelectedField = {
  sourceId: string;
  sourceName: string;
  sourceType: SourceType;
  fieldName: string;
  fieldType: string;
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
  /** Callback when a field is selected */
  onSelect: (field: SelectedField) => void;
  /** Callback when "create new variable" is selected */
  onCreateVariable?: (name: string) => void;
  /** Callback when menu should close */
  onClose: () => void;
  /** Expected type for type mismatch warnings */
  expectedType?: string;
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
        icon={<Text fontSize="10px">📊</Text>}
      />
    );
  }
  return <ComponentIcon type={type as ComponentType} size="xs" />;
};

// ============================================================================
// Main Component
// ============================================================================

// Menu dimensions (approximate)
const MENU_WIDTH = 300;
const MENU_MAX_HEIGHT = 350;
const VIEWPORT_PADDING = 8;

export const VariableInsertMenu = ({
  isOpen,
  position,
  availableSources,
  query,
  onQueryChange,
  highlightedIndex,
  onHighlightChange,
  onSelect,
  onCreateVariable,
  onClose,
  expectedType,
}: VariableInsertMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Adjusted position to keep menu within viewport
  const [adjustedPosition, setAdjustedPosition] = useState(position);

  // Adjust position to keep menu within viewport bounds
  useEffect(() => {
    if (!isOpen) return;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let adjustedLeft = position.left;
    let adjustedTop = position.top;

    // Adjust horizontal position if menu would go off right edge
    if (position.left + MENU_WIDTH > viewportWidth - VIEWPORT_PADDING) {
      adjustedLeft = Math.max(
        VIEWPORT_PADDING,
        viewportWidth - MENU_WIDTH - VIEWPORT_PADDING
      );
    }

    // Adjust vertical position if menu would go off bottom edge
    if (position.top + MENU_MAX_HEIGHT > viewportHeight - VIEWPORT_PADDING) {
      // Try positioning above the cursor instead
      adjustedTop = Math.max(
        VIEWPORT_PADDING,
        position.top - MENU_MAX_HEIGHT - 20 // 20px offset for cursor
      );
    }

    setAdjustedPosition({ top: adjustedTop, left: adjustedLeft });
  }, [isOpen, position]);

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen, onClose]);

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
            field.name.toLowerCase().includes(query.toLowerCase())
          ),
        }))
        .filter((source) => source.fields.length > 0),
    [availableSources, query]
  );

  // Normalize query for variable creation
  const normalizedQuery = query.trim().replace(/ /g, "_").toLowerCase();

  // Check if there's an exact match with the normalized query
  const hasExactMatch = useMemo(
    () =>
      filteredSources.some((source) =>
        source.fields.some(
          (field) => field.name.toLowerCase() === normalizedQuery
        )
      ),
    [filteredSources, normalizedQuery]
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
          field: { name: string; type: string };
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
    [flattenedOptions, onSelect, onCreateVariable]
  );

  // Expose methods for parent to call on keyboard events
  const selectHighlighted = useCallback(() => {
    handleSelect(highlightedIndex);
  }, [handleSelect, highlightedIndex]);

  const moveHighlightUp = useCallback(() => {
    onHighlightChange(Math.max(highlightedIndex - 1, 0));
  }, [highlightedIndex, onHighlightChange]);

  const moveHighlightDown = useCallback(() => {
    onHighlightChange(Math.min(highlightedIndex + 1, flattenedOptions.length - 1));
  }, [highlightedIndex, flattenedOptions.length, onHighlightChange]);

  // Attach keyboard handlers to parent (via ref or expose)
  // Actually, the parent will handle keyboard events and call these

  if (!isOpen) return null;

  // Track current field index for highlighting
  let currentFieldIndex = 0;

  return (
    <Portal>
      <Box
        ref={menuRef}
        position="fixed"
        top={`${adjustedPosition.top}px`}
        left={`${adjustedPosition.left}px`}
        width={`${MENU_WIDTH}px`}
        maxHeight={`${MENU_MAX_HEIGHT}px`}
        background="white"
        borderRadius="8px"
        boxShadow="lg"
        border="1px solid"
        borderColor="gray.200"
        zIndex="popover"
        overflow="hidden"
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
                  onHighlightChange(
                    Math.min(highlightedIndex + 1, flattenedOptions.length - 1)
                  );
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
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
                    const isTypeMismatch =
                      expectedType && field.type !== expectedType;

                    return (
                      <HStack
                        key={`${source.id}-${field.name}`}
                        paddingX={3}
                        paddingY={2}
                        gap={2}
                        cursor="pointer"
                        borderRadius="4px"
                        background={isHighlighted ? "blue.50" : undefined}
                        _hover={{ background: "blue.50" }}
                        onClick={() => handleSelect(optionIndex)}
                      >
                        <VariableTypeIcon type={field.type} size={12} />
                        <Text fontSize="13px" fontFamily="mono" flex={1}>
                          {field.name}
                        </Text>
                        <VariableTypeBadge type={field.type} size="xs" />
                        {isTypeMismatch && (
                          <AlertTriangle
                            size={12}
                            color="var(--chakra-colors-orange-500)"
                          />
                        )}
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
                    highlightedIndex === createOptionIndex ? "blue.50" : undefined
                  }
                  _hover={{ background: "blue.50" }}
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
      </Box>
    </Portal>
  );
};

// Export helper to get option count for parent component
export const getMenuOptionCount = (
  availableSources: AvailableSource[],
  query: string,
  canCreate: boolean
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
    source.fields.some((field) => field.name.toLowerCase() === normalizedQuery)
  );

  if (canCreate && normalizedQuery && !hasExactMatch) {
    count++;
  }

  return count;
};

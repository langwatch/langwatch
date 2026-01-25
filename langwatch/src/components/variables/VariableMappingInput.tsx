import {
  Box,
  HStack,
  Input,
  Portal,
  Tag,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Check, ChevronRight, Database, Type } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ColorfulBlockIcon,
  ComponentIcon,
} from "~/optimization_studio/components/ColorfulBlockIcons";
import type { ComponentType, Field } from "~/optimization_studio/types/dsl";
import {
  VariableTypeBadge,
  VariableTypeIcon,
} from "~/prompts/components/ui/VariableTypeIcon";

// ============================================================================
// Types
// ============================================================================

/** Source types aligned with DSL ComponentType + dataset */
export type SourceType = ComponentType | "dataset";

/** Field type - uses DSL Field type for strong typing */
export type FieldType = Field["type"];

/**
 * Represents a field that can be selected in the mapping dropdown.
 * Supports nested fields via the `children` property.
 *
 * Examples:
 * - Simple field: { name: "input", type: "str" }
 * - Field with static children: { name: "metadata", type: "dict", children: [...] }
 * - Field with dynamic children: { name: "spans", type: "list", getChildren: () => [...] }
 */
export type NestedField = {
  /** Field name (used as path segment) */
  name: string;
  /** Display label (defaults to name if not provided) */
  label?: string;
  /** Field type for display */
  type: FieldType;
  /**
   * Static children - use when children are known at definition time.
   * Example: spans always have input/output/params subfields.
   */
  children?: NestedField[];
  /**
   * Dynamic children - use when children depend on runtime data.
   * Example: metadata keys depend on actual trace data.
   * The function is called when the field is selected to populate nested options.
   */
  getChildren?: () => NestedField[];
  /**
   * Whether selecting this field is "complete" or requires further selection.
   * - Default: true if no children/getChildren, false if has children
   * - Override: Set to true to allow selecting a parent without drilling down
   *   (e.g., "spans" can be selected as a whole OR drilled into)
   */
  isComplete?: boolean;
};

export type AvailableSource = {
  id: string;
  name: string;
  type: SourceType;
  /** Fields available for mapping. Supports nested fields via children. */
  fields: NestedField[];
};

/**
 * Field mapping - either to a source field or a hardcoded value.
 *
 * For source mappings, `path` is an array of field segments:
 * - Simple field: ["input"]
 * - Nested field: ["metadata", "customer_id"]
 * - Deeply nested: ["spans", "gpt-4", "output"]
 */
export type FieldMapping =
  | { type: "source"; sourceId: string; path: string[] }
  | { type: "value"; value: string };

type VariableMappingInputProps = {
  /** Current mapping (source or value) */
  mapping?: FieldMapping;
  /** Callback when mapping changes */
  onMappingChange?: (mapping: FieldMapping | undefined) => void;
  /** Available sources to map from */
  availableSources: AvailableSource[];
  /** Placeholder text */
  placeholder?: string;
  /** Whether the input is disabled */
  disabled?: boolean;
  /** Whether this mapping is missing and should be highlighted */
  isMissing?: boolean;
  /** When true, shows yellow background but not "Required" placeholder (for optional fields) */
  optionalHighlighting?: boolean;
};

/** Represents a selectable option in the dropdown */
type DropdownOption =
  | {
      type: "field";
      sourceId: string;
      sourceName: string;
      sourceType: SourceType;
      field: NestedField;
    }
  | { type: "value"; value: string };

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a field has nested children (either static or dynamic)
 */
const hasChildren = (field: NestedField): boolean => {
  return !!(field.children?.length || field.getChildren);
};

/**
 * Get children for a field (handles both static and dynamic)
 */
const getFieldChildren = (field: NestedField): NestedField[] => {
  if (field.children) return field.children;
  if (field.getChildren) return field.getChildren();
  return [];
};

/**
 * Check if selecting a field is "complete" (doesn't require further selection)
 */
const isFieldComplete = (field: NestedField): boolean => {
  // Explicit override
  if (field.isComplete !== undefined) return field.isComplete;
  // Default: complete if no children
  return !hasChildren(field);
};

/**
 * Find a field by name in a list of fields
 */
const findFieldByName = (
  fields: NestedField[],
  name: string,
): NestedField | undefined => {
  return fields.find((f) => f.name === name);
};

// ============================================================================
// Source Type Icons
// ============================================================================

const SourceTypeIconComponent = ({ type }: { type: SourceType }) => {
  // Dataset is not a ComponentType, so handle it separately
  if (type === "dataset") {
    return (
      <ColorfulBlockIcon
        color="blue.solid"
        size="xs"
        icon={<Database size={12} />}
      />
    );
  }

  // Use ComponentIcon for all DSL component types
  return <ComponentIcon type={type} size="xs" />;
};

// ============================================================================
// Main Component
// ============================================================================

export const VariableMappingInput = ({
  mapping,
  onMappingChange,
  availableSources,
  placeholder = "Enter value or select source...",
  disabled = false,
  isMissing = false,
  optionalHighlighting = false,
}: VariableMappingInputProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [isKeyboardNav, setIsKeyboardNav] = useState(false);
  // Local state to track the current value - prevents stale prop issues
  const [localMapping, setLocalMapping] = useState<FieldMapping | undefined>(
    mapping,
  );
  // Track in-progress path selection (for nested fields)
  // This is the path being built up as user selects nested options
  const [inProgressPath, setInProgressPath] = useState<{
    sourceId: string;
    path: string[];
  } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync local mapping when prop changes (e.g., from external updates)
  useEffect(() => {
    setLocalMapping(mapping);
  }, [mapping]);

  // Helper to check if mapping is a source mapping
  const isSourceMapping = localMapping?.type === "source";
  const isValueMapping = localMapping?.type === "value";

  // Get source info for the current mapping
  const sourceInfo = useMemo(() => {
    if (isSourceMapping && localMapping) {
      const source = availableSources.find(
        (s) => s.id === localMapping.sourceId,
      );
      return source ? { source, path: localMapping.path } : null;
    }
    return null;
  }, [localMapping, isSourceMapping, availableSources]);

  // Get the current fields to show in dropdown (handles nesting)
  const currentDropdownContext = useMemo(() => {
    // If we have an in-progress path, show children of the last selected field
    if (inProgressPath) {
      const source = availableSources.find(
        (s) => s.id === inProgressPath.sourceId,
      );
      if (!source)
        return {
          fields: [],
          source: null,
          depth: 0,
          parentFieldName: null,
          isParentComplete: false,
        };

      let currentFields = source.fields;
      let parentField: NestedField | undefined;
      for (const segment of inProgressPath.path) {
        const field = findFieldByName(currentFields, segment);
        if (!field)
          return {
            fields: [],
            source,
            depth: inProgressPath.path.length,
            parentFieldName: null,
            isParentComplete: false,
          };
        parentField = field;
        currentFields = getFieldChildren(field);
      }

      // Check if the parent (last segment in path) is complete
      const isParentComplete = parentField
        ? isFieldComplete(parentField)
        : false;
      const parentFieldName =
        inProgressPath.path[inProgressPath.path.length - 1] ?? null;

      return {
        fields: currentFields,
        source,
        depth: inProgressPath.path.length,
        parentFieldName,
        isParentComplete,
      };
    }

    // Otherwise show top-level fields from all sources
    return {
      fields: null,
      source: null,
      depth: 0,
      parentFieldName: null,
      isParentComplete: false,
    };
  }, [availableSources, inProgressPath]);

  // Get display value for the input (only for value mappings now)
  const getDisplayValue = useCallback(() => {
    if (isValueMapping && localMapping) {
      return localMapping.value;
    }
    return "";
  }, [localMapping, isValueMapping]);

  // Filter sources/fields based on search query and current context
  const filteredSources = useMemo(() => {
    // If we're in nested selection mode, filter the nested fields
    if (currentDropdownContext.fields && currentDropdownContext.source) {
      const filtered = currentDropdownContext.fields.filter((field) =>
        (field.label ?? field.name)
          .toLowerCase()
          .includes(searchQuery.toLowerCase()),
      );
      return [
        {
          ...currentDropdownContext.source,
          fields: filtered,
        },
      ];
    }

    // Otherwise filter top-level fields from all sources
    return availableSources
      .map((source) => ({
        ...source,
        fields: source.fields.filter((field) =>
          (field.label ?? field.name)
            .toLowerCase()
            .includes(searchQuery.toLowerCase()),
        ),
      }))
      .filter((source) => source.fields.length > 0);
  }, [availableSources, searchQuery, currentDropdownContext]);

  // Build flat list of options for keyboard navigation
  const allOptions: DropdownOption[] = useMemo(() => {
    const options: DropdownOption[] = [];

    // Add all source fields
    for (const source of filteredSources) {
      for (const field of source.fields) {
        options.push({
          type: "field",
          sourceId: source.id,
          sourceName: source.name,
          sourceType: source.type,
          field,
        });
      }
    }

    // Add "use as value" option if user typed something (only at top level)
    if (searchQuery.trim() && !inProgressPath) {
      options.push({ type: "value", value: searchQuery.trim() });
    }

    return options;
  }, [filteredSources, searchQuery, inProgressPath]);

  // Reset highlighted index when options change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [allOptions.length]);

  // Clear the current mapping
  const handleClearMapping = useCallback(() => {
    setLocalMapping(undefined);
    setInProgressPath(null);
    onMappingChange?.(undefined);
    setSearchQuery("");
    // Re-focus the input after clearing
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [onMappingChange]);

  // Clear just the last path segment (for backspace on nested selection)
  const handleClearLastPathSegment = useCallback(() => {
    if (inProgressPath && inProgressPath.path.length > 0) {
      const newPath = inProgressPath.path.slice(0, -1);
      if (newPath.length === 0) {
        setInProgressPath(null);
      } else {
        setInProgressPath({ ...inProgressPath, path: newPath });
      }
      setSearchQuery("");
    } else if (
      isSourceMapping &&
      localMapping &&
      localMapping.path.length > 1
    ) {
      // Remove last segment from completed mapping
      const newPath = localMapping.path.slice(0, -1);
      const newMapping: FieldMapping = {
        type: "source",
        sourceId: localMapping.sourceId,
        path: newPath,
      };
      setLocalMapping(newMapping);
      onMappingChange?.(newMapping);
    } else {
      handleClearMapping();
    }
  }, [
    inProgressPath,
    isSourceMapping,
    localMapping,
    onMappingChange,
    handleClearMapping,
  ]);

  // Handle input change - updates search query
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    setHighlightedIndex(0);
    setIsOpen(true); // Open dropdown when typing
    // If user starts typing while having a value mapping, clear it
    if (isValueMapping && localMapping) {
      setLocalMapping(undefined);
      onMappingChange?.(undefined);
    }
  };

  // Handle option selection
  const handleSelectOption = useCallback(
    (option: DropdownOption) => {
      if (option.type === "field") {
        const field = option.field;
        const currentPath = inProgressPath?.path ?? [];
        const newPath = [...currentPath, field.name];

        // Create the mapping for this selection
        const newMapping: FieldMapping = {
          type: "source",
          sourceId: option.sourceId,
          path: newPath,
        };

        // If field has children, show nested options
        // But if the field is also "complete" (can be selected as-is), set the mapping too
        if (hasChildren(field)) {
          // If field is complete, set the mapping now (user can still drill down)
          // This allows selecting "traces" as a valid value while also showing nested options
          if (isFieldComplete(field)) {
            setLocalMapping(newMapping);
            onMappingChange?.(newMapping);
          }

          // Continue building the path - show children
          setInProgressPath({
            sourceId: option.sourceId,
            path: newPath,
          });
          setSearchQuery("");
          setHighlightedIndex(0);
          // Keep dropdown open to show children
          return;
        }

        // Field has no children - finalize the mapping
        setLocalMapping(newMapping);
        setInProgressPath(null);
        onMappingChange?.(newMapping);
        setIsOpen(false);
        setSearchQuery("");
      } else {
        const newMapping: FieldMapping = { type: "value", value: option.value };
        setLocalMapping(newMapping);
        setInProgressPath(null);
        onMappingChange?.(newMapping);
        setIsOpen(false);
        setSearchQuery("");
      }
    },
    [onMappingChange, inProgressPath],
  );

  // Handle selecting the current path as-is (for "Use all X" option)
  const handleSelectCurrentPath = useCallback(() => {
    if (!inProgressPath) return;

    const newMapping: FieldMapping = {
      type: "source",
      sourceId: inProgressPath.sourceId,
      path: inProgressPath.path,
    };
    setLocalMapping(newMapping);
    setInProgressPath(null);
    onMappingChange?.(newMapping);
    setIsOpen(false);
    setSearchQuery("");
  }, [inProgressPath, onMappingChange]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Handle backspace to clear/navigate back when input is empty
      if (e.key === "Backspace" && searchQuery === "") {
        e.preventDefault();
        if (inProgressPath) {
          // Go back one level in nested selection
          handleClearLastPathSegment();
        } else if (isSourceMapping) {
          // Clear the mapping
          handleClearMapping();
        }
        return;
      }

      if (!isOpen) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          setIsOpen(true);
          setIsKeyboardNav(true);
          e.preventDefault();
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setIsKeyboardNav(true);
          setHighlightedIndex((prev) =>
            prev < allOptions.length - 1 ? prev + 1 : prev,
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setIsKeyboardNav(true);
          setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
          break;
        case "Enter":
          e.preventDefault();
          if (allOptions[highlightedIndex]) {
            handleSelectOption(allOptions[highlightedIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          setInProgressPath(null);
          setIsOpen(false);
          setSearchQuery("");
          break;
      }
    },
    [
      isOpen,
      allOptions,
      highlightedIndex,
      handleSelectOption,
      isSourceMapping,
      searchQuery,
      handleClearMapping,
      handleClearLastPathSegment,
      inProgressPath,
    ],
  );

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Calculate dropdown position with flip behavior
  const [dropdownPosition, setDropdownPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
    placement: "bottom" as "bottom" | "top",
  });

  const DROPDOWN_MAX_HEIGHT = 300;
  const DROPDOWN_GAP = 4;

  // Update dropdown position - called on open and after content changes
  const updateDropdownPosition = useCallback(() => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;

    // Check if there's enough space below
    const spaceBelow = viewportHeight - rect.bottom - DROPDOWN_GAP;
    const spaceAbove = rect.top - DROPDOWN_GAP;

    // If not enough space below but more space above, flip to top
    const shouldFlipToTop =
      spaceBelow < DROPDOWN_MAX_HEIGHT && spaceAbove > spaceBelow;

    if (shouldFlipToTop) {
      // Position above the input - measure actual dropdown height
      const actualDropdownHeight =
        dropdownRef.current?.offsetHeight ?? DROPDOWN_MAX_HEIGHT;
      const dropdownHeight = Math.min(actualDropdownHeight, spaceAbove);
      setDropdownPosition({
        top: rect.top - dropdownHeight - DROPDOWN_GAP,
        left: rect.left,
        width: rect.width,
        placement: "top",
      });
    } else {
      // Position below the input (default)
      setDropdownPosition({
        top: rect.bottom + DROPDOWN_GAP,
        left: rect.left,
        width: rect.width,
        placement: "bottom",
      });
    }
  }, []);

  // Initial position calculation when opening
  useEffect(() => {
    if (isOpen) {
      updateDropdownPosition();
    }
  }, [isOpen, updateDropdownPosition]);

  // Recalculate position when content changes (nested navigation, filtering)
  useEffect(() => {
    if (isOpen) {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        updateDropdownPosition();
      });
    }
  }, [isOpen, filteredSources, inProgressPath, updateDropdownPosition]);

  // Track current option index for highlighting
  let currentOptionIndex = -1;

  return (
    <Box position="relative" ref={containerRef} width="full">
      {/* Container with full-width bottom border */}
      <Box
        borderBottom="1px solid"
        borderColor={isMissing ? "yellow.500" : "border"}
        background={isMissing ? "orange.50" : undefined}
        // borderRadius={isMissing ? "md" : undefined}
        paddingX={isMissing ? 1 : undefined}
        _focusWithin={{
          borderColor: isMissing ? "yellow.600" : "blue.500",
          boxShadow: isMissing
            ? "var(--chakra-colors-yellow-400) 0px 1px 0px 0px"
            : "var(--chakra-colors-blue-500) 0px 1px 0px 0px",
        }}
        cursor={disabled ? "not-allowed" : "text"}
        onClick={() => {
          if (!disabled) {
            setIsOpen(true);
            inputRef.current?.focus();
          }
        }}
        data-testid={isMissing ? "missing-mapping-input" : undefined}
      >
        <HStack gap={1} paddingY={1} paddingX={1} flexWrap="wrap">
          {/* Source mapping displayed as a closable tag */}
          {isSourceMapping && sourceInfo && !inProgressPath && (
            <Tag.Root
              size="md"
              colorPalette="blue"
              variant="subtle"
              data-testid="source-mapping-tag"
            >
              <SourceTypeIconComponent type={sourceInfo.source.type} />
              <Tag.Label fontFamily="mono" fontSize="12px">
                {sourceInfo.path.join(".")}
              </Tag.Label>
              <Tag.EndElement>
                <Tag.CloseTrigger
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!disabled) {
                      handleClearMapping();
                    }
                  }}
                  data-testid="clear-mapping-button"
                />
              </Tag.EndElement>
            </Tag.Root>
          )}

          {/* In-progress path badges (when building nested selection) */}
          {inProgressPath?.path.map((segment, index) => {
            const source = availableSources.find(
              (s) => s.id === inProgressPath.sourceId,
            );
            return (
              <HStack key={`${segment}-${index}`} gap={0}>
                <Tag.Root
                  size="md"
                  colorPalette="blue"
                  variant="subtle"
                  data-testid={`path-segment-tag-${index}`}
                >
                  {index === 0 && source && (
                    <SourceTypeIconComponent type={source.type} />
                  )}
                  <Tag.Label fontFamily="mono" fontSize="12px">
                    {segment}
                  </Tag.Label>
                  <Tag.EndElement>
                    <Tag.CloseTrigger
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!disabled) {
                          // Clear from this segment onwards
                          if (index === 0) {
                            setInProgressPath(null);
                          } else {
                            setInProgressPath({
                              ...inProgressPath,
                              path: inProgressPath.path.slice(0, index),
                            });
                          }
                        }
                      }}
                    />
                  </Tag.EndElement>
                </Tag.Root>
                {index < inProgressPath.path.length - 1 && (
                  <ChevronRight
                    size={12}
                    color="var(--chakra-colors-gray-400)"
                  />
                )}
              </HStack>
            );
          })}

          <Input
            ref={inputRef}
            value={
              isOpen ? searchQuery : isSourceMapping ? "" : getDisplayValue()
            }
            onChange={handleInputChange}
            onFocus={() => setIsOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={
              isMissing && !optionalHighlighting
                ? "Required"
                : isSourceMapping
                  ? ""
                  : inProgressPath
                    ? "Select nested field..."
                    : placeholder
            }
            _placeholder={{ color: isMissing ? "yellow.600" : undefined }}
            size="sm"
            border="none"
            outline="none"
            borderRadius="none"
            background="transparent"
            _focus={{ boxShadow: "none", border: "none" }}
            _hover={{ border: "none" }}
            fontSize="13px"
            disabled={disabled}
            flex={1}
            minWidth={isSourceMapping || inProgressPath ? "20px" : undefined}
            height="24px"
            paddingX={0}
          />
        </HStack>
      </Box>

      {/* Dropdown */}
      {isOpen && !disabled && (
        <Portal>
          <Box
            ref={dropdownRef}
            position="fixed"
            top={`${dropdownPosition.top}px`}
            left={`${dropdownPosition.left}px`}
            width={`${Math.max(dropdownPosition.width, 280)}px`}
            maxHeight={`${DROPDOWN_MAX_HEIGHT}px`}
            overflowY="auto"
            background="bg.panel"
            borderRadius="8px"
            boxShadow="lg"
            border="1px solid"
            borderColor="border"
            zIndex={2000}
          >
            {allOptions.length === 0 ? (
              <Box padding={3}>
                <Text fontSize="sm" color="fg.muted">
                  No available sources
                </Text>
              </Box>
            ) : (
              <VStack align="stretch" gap={0} padding={1}>
                {/* Show breadcrumb for nested selection */}
                {inProgressPath && inProgressPath.path.length > 0 && (
                  <HStack
                    paddingX={2}
                    paddingY={1}
                    gap={1}
                    background="blue.50"
                    borderRadius="4px"
                    marginBottom={1}
                  >
                    <Text fontSize="xs" color="blue.600">
                      {inProgressPath.path.join(" → ")}
                    </Text>
                    <Text fontSize="xs" color="blue.400">
                      →
                    </Text>
                  </HStack>
                )}

                {/* "Use all X" option when parent is complete */}
                {currentDropdownContext.isParentComplete &&
                  currentDropdownContext.parentFieldName && (
                    <HStack
                      paddingX={3}
                      paddingY={2}
                      gap={2}
                      cursor="pointer"
                      borderRadius="4px"
                      background={
                        highlightedIndex === -1 ? "blue.50" : "transparent"
                      }
                      _hover={{ background: "blue.50" }}
                      onClick={handleSelectCurrentPath}
                      onMouseMove={() => {
                        if (isKeyboardNav || highlightedIndex !== -1) {
                          setIsKeyboardNav(false);
                          setHighlightedIndex(-1);
                        }
                      }}
                      data-testid="use-all-option"
                      borderBottom="1px solid"
                      borderColor="gray.100"
                      marginBottom={1}
                    >
                      <Check size={12} color="var(--chakra-colors-green-500)" />
                      <Text
                        fontSize="13px"
                        fontWeight="medium"
                        color="green.600"
                      >
                        Use all {currentDropdownContext.parentFieldName}
                      </Text>
                    </HStack>
                  )}

                {filteredSources.map((source) => (
                  <Box key={source.id}>
                    {/* Source header - only show at top level */}
                    {!inProgressPath && (
                      <HStack
                        paddingX={2}
                        paddingY={1}
                        gap={2}
                        background="bg.subtle"
                        borderRadius="4px"
                        marginBottom={1}
                      >
                        <SourceTypeIconComponent type={source.type} />
                        <Text
                          fontSize="xs"
                          fontWeight="semibold"
                          color="fg.muted"
                        >
                          {source.name}
                        </Text>
                      </HStack>
                    )}

                    {/* Fields */}
                    {source.fields.map((field) => {
                      currentOptionIndex++;
                      const optionIdx = currentOptionIndex;
                      const isHighlighted = optionIdx === highlightedIndex;
                      const fieldHasChildren = hasChildren(field);

                      return (
                        <HStack
                          key={`${source.id}-${field.name}`}
                          paddingX={3}
                          paddingY={2}
                          gap={2}
                          cursor="pointer"
                          borderRadius="4px"
                          background={isHighlighted ? "blue.50" : "transparent"}
                          onMouseMove={() => {
                            if (
                              isKeyboardNav ||
                              highlightedIndex !== optionIdx
                            ) {
                              setIsKeyboardNav(false);
                              setHighlightedIndex(optionIdx);
                            }
                          }}
                          onClick={() =>
                            handleSelectOption({
                              type: "field",
                              sourceId: source.id,
                              sourceName: source.name,
                              sourceType: source.type,
                              field,
                            })
                          }
                          data-highlighted={isHighlighted}
                          data-testid={`field-option-${field.name}`}
                        >
                          <VariableTypeIcon type={field.type} size={12} />
                          <Text fontSize="13px" fontFamily="mono" flex={1}>
                            {field.label ?? field.name}
                          </Text>
                          {fieldHasChildren ? (
                            <ChevronRight
                              size={14}
                              color="var(--chakra-colors-gray-400)"
                            />
                          ) : (
                            <VariableTypeBadge type={field.type} size="xs" />
                          )}
                        </HStack>
                      );
                    })}
                  </Box>
                ))}

                {/* "Use as value" option when user typed something (only at top level) */}
                {searchQuery.trim() && !inProgressPath && (
                  <div data-testid="use-as-value-option">
                    {filteredSources.length > 0 && (
                      <Box height="1px" background="border" marginY={1} />
                    )}
                    <HStack
                      paddingX={3}
                      paddingY={2}
                      gap={2}
                      cursor="pointer"
                      borderRadius="4px"
                      background={
                        highlightedIndex === allOptions.length - 1
                          ? "blue.50"
                          : "transparent"
                      }
                      onMouseMove={() => {
                        const valueOptionIdx = allOptions.length - 1;
                        if (
                          isKeyboardNav ||
                          highlightedIndex !== valueOptionIdx
                        ) {
                          setIsKeyboardNav(false);
                          setHighlightedIndex(valueOptionIdx);
                        }
                      }}
                      onClick={() =>
                        handleSelectOption({
                          type: "value",
                          value: searchQuery.trim(),
                        })
                      }
                      data-highlighted={
                        highlightedIndex === allOptions.length - 1
                      }
                    >
                      <Type size={14} color="var(--chakra-colors-gray-500)" />
                      <Text fontSize="13px" color="fg.muted">
                        Use "
                        <Text as="span" fontWeight="medium" color="fg">
                          {searchQuery.trim()}
                        </Text>
                        " as value
                      </Text>
                    </HStack>
                  </div>
                )}
              </VStack>
            )}
          </Box>
        </Portal>
      )}
    </Box>
  );
};

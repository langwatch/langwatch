import {
  Box,
  HStack,
  Input,
  Portal,
  Tag,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Database, Type } from "lucide-react";
import { VariableTypeIcon, VariableTypeBadge } from "~/prompts/components/ui/VariableTypeIcon";
import { ComponentIcon, ColorfulBlockIcon } from "~/optimization_studio/components/ColorfulBlockIcons";
import type { ComponentType, Field } from "~/optimization_studio/types/dsl";

// ============================================================================
// Types
// ============================================================================

/** Source types aligned with DSL ComponentType + dataset */
export type SourceType = ComponentType | "dataset";

/** Field type - uses DSL Field type for strong typing */
export type FieldType = Field["type"];

export type AvailableSource = {
  id: string;
  name: string;
  type: SourceType;
  fields: Array<{
    name: string;
    type: FieldType;
    path?: string; // For nested fields: "output_parsed.company_name"
  }>;
};

/**
 * Field mapping - either to a source field or a hardcoded value.
 */
export type FieldMapping =
  | { type: "source"; sourceId: string; field: string }
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
};

/** Represents a selectable option in the dropdown */
type DropdownOption =
  | { type: "field"; sourceId: string; sourceName: string; sourceType: SourceType; fieldName: string; fieldType: string }
  | { type: "value"; value: string };

// ============================================================================
// Source Type Icons
// ============================================================================

const SourceTypeIconComponent = ({ type }: { type: SourceType }) => {
  // Dataset is not a ComponentType, so handle it separately
  if (type === "dataset") {
    return (
      <ColorfulBlockIcon
        color="blue.400"
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
}: VariableMappingInputProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [isKeyboardNav, setIsKeyboardNav] = useState(false);
  // Local state to track the current value - prevents stale prop issues
  const [localMapping, setLocalMapping] = useState<FieldMapping | undefined>(mapping);
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
      const source = availableSources.find((s) => s.id === localMapping.sourceId);
      return source ? { source, field: localMapping.field } : null;
    }
    return null;
  }, [localMapping, isSourceMapping, availableSources]);

  // Get display value for the input (only for value mappings now)
  const getDisplayValue = useCallback(() => {
    if (isValueMapping && localMapping) {
      return localMapping.value;
    }
    return "";
  }, [localMapping, isValueMapping]);

  // Filter sources based on search query
  const filteredSources = useMemo(() =>
    availableSources
      .map((source) => ({
        ...source,
        fields: source.fields.filter((field) =>
          field.name.toLowerCase().includes(searchQuery.toLowerCase())
        ),
      }))
      .filter((source) => source.fields.length > 0),
    [availableSources, searchQuery]
  );

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
          fieldName: field.name,
          fieldType: field.type,
        });
      }
    }

    // Add "use as value" option if user typed something
    if (searchQuery.trim()) {
      options.push({ type: "value", value: searchQuery.trim() });
    }

    return options;
  }, [filteredSources, searchQuery]);

  // Reset highlighted index when options change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [allOptions.length]);

  // Clear the current mapping
  const handleClearMapping = useCallback(() => {
    setLocalMapping(undefined);
    onMappingChange?.(undefined);
    setSearchQuery("");
    // Re-focus the input after clearing
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [onMappingChange]);

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
  const handleSelectOption = useCallback((option: DropdownOption) => {
    if (option.type === "field") {
      const newMapping: FieldMapping = { type: "source", sourceId: option.sourceId, field: option.fieldName };
      setLocalMapping(newMapping);
      onMappingChange?.(newMapping);
    } else {
      const newMapping: FieldMapping = { type: "value", value: option.value };
      setLocalMapping(newMapping);
      onMappingChange?.(newMapping);
    }
    setIsOpen(false);
    setSearchQuery("");
  }, [onMappingChange]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    // Handle backspace to clear source mapping when input is empty
    if (e.key === "Backspace" && isSourceMapping && searchQuery === "") {
      e.preventDefault();
      handleClearMapping();
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
          prev < allOptions.length - 1 ? prev + 1 : prev
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
        setIsOpen(false);
        setSearchQuery("");
        break;
    }
  }, [isOpen, allOptions, highlightedIndex, handleSelectOption, isSourceMapping, searchQuery, handleClearMapping]);

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

  // Calculate dropdown position
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });

  useEffect(() => {
    if (isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    }
  }, [isOpen]);

  // Track current option index for highlighting
  let currentOptionIndex = -1;

  return (
    <Box position="relative" ref={containerRef} width="full">
      {/* Container with full-width bottom border */}
      <Box
        borderBottom="1px solid"
        borderColor="gray.200"
        _focusWithin={{ borderColor: "blue.500", boxShadow: "var(--chakra-colors-blue-500) 0px 1px 0px 0px" }}
        cursor={disabled ? "not-allowed" : "text"}
        onClick={() => {
          if (!disabled) {
            setIsOpen(true);
            inputRef.current?.focus();
          }
        }}
      >
        <HStack gap={1} paddingY={1} paddingX={1}>
          {/* Source mapping displayed as a closable tag */}
          {isSourceMapping && sourceInfo && (
            <Tag.Root
              size="md"
              colorPalette="blue"
              variant="subtle"
              data-testid="source-mapping-tag"
            >
              <SourceTypeIconComponent type={sourceInfo.source.type} />
              <Tag.Label fontFamily="mono" fontSize="12px">
                {sourceInfo.field}
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

          <Input
            ref={inputRef}
            value={isOpen ? searchQuery : (isSourceMapping ? "" : getDisplayValue())}
            onChange={handleInputChange}
            onFocus={() => setIsOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={isSourceMapping ? "" : placeholder}
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
            minWidth={isSourceMapping ? "20px" : undefined}
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
            maxHeight="300px"
            overflowY="auto"
            background="white"
            borderRadius="8px"
            boxShadow="lg"
            border="1px solid"
            borderColor="gray.200"
            zIndex={2000}
          >
            {allOptions.length === 0 ? (
              <Box padding={3}>
                <Text fontSize="sm" color="gray.500">
                  No available sources
                </Text>
              </Box>
            ) : (
              <VStack align="stretch" gap={0} padding={1}>
                {filteredSources.map((source) => (
                  <Box key={source.id}>
                    {/* Source header */}
                    <HStack
                      paddingX={2}
                      paddingY={1}
                      gap={2}
                      background="gray.50"
                      borderRadius="4px"
                      marginBottom={1}
                    >
                      <SourceTypeIconComponent type={source.type} />
                      <Text fontSize="xs" fontWeight="semibold" color="gray.600">
                        {source.name}
                      </Text>
                    </HStack>

                    {/* Fields */}
                    {source.fields.map((field) => {
                      currentOptionIndex++;
                      const optionIdx = currentOptionIndex;
                      const isHighlighted = optionIdx === highlightedIndex;

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
                            if (isKeyboardNav || highlightedIndex !== optionIdx) {
                              setIsKeyboardNav(false);
                              setHighlightedIndex(optionIdx);
                            }
                          }}
                          onClick={() => handleSelectOption({
                            type: "field",
                            sourceId: source.id,
                            sourceName: source.name,
                            sourceType: source.type,
                            fieldName: field.name,
                            fieldType: field.type,
                          })}
                          data-highlighted={isHighlighted}
                        >
                          <VariableTypeIcon type={field.type} size={12} />
                          <Text
                            fontSize="13px"
                            fontFamily="mono"
                            flex={1}
                          >
                            {field.name}
                          </Text>
                          <VariableTypeBadge type={field.type} size="xs" />
                        </HStack>
                      );
                    })}
                  </Box>
                ))}

                {/* "Use as value" option when user typed something */}
                {searchQuery.trim() && (
                  <div data-testid="use-as-value-option">
                    {filteredSources.length > 0 && (
                      <Box height="1px" background="gray.200" marginY={1} />
                    )}
                    <HStack
                      paddingX={3}
                      paddingY={2}
                      gap={2}
                      cursor="pointer"
                      borderRadius="4px"
                      background={highlightedIndex === allOptions.length - 1 ? "blue.50" : "transparent"}
                      onMouseMove={() => {
                        const valueOptionIdx = allOptions.length - 1;
                        if (isKeyboardNav || highlightedIndex !== valueOptionIdx) {
                          setIsKeyboardNav(false);
                          setHighlightedIndex(valueOptionIdx);
                        }
                      }}
                      onClick={() => handleSelectOption({ type: "value", value: searchQuery.trim() })}
                      data-highlighted={highlightedIndex === allOptions.length - 1}
                    >
                      <Type size={14} color="var(--chakra-colors-gray-500)" />
                      <Text fontSize="13px" color="gray.600">
                        Use "<Text as="span" fontWeight="medium" color="gray.800">{searchQuery.trim()}</Text>" as value
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

import {
  Box,
  HStack,
  Input,
  Portal,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Database } from "lucide-react";
import { VariableTypeIcon, VariableTypeBadge } from "~/prompts/components/ui/VariableTypeIcon";
import { ComponentIcon, ColorfulBlockIcon } from "~/optimization_studio/components/ColorfulBlockIcons";
import type { ComponentType } from "~/optimization_studio/types/dsl";

// ============================================================================
// Types
// ============================================================================

/** Source types aligned with DSL ComponentType + dataset */
export type SourceType = ComponentType | "dataset";

export type AvailableSource = {
  id: string;
  name: string;
  type: SourceType;
  fields: Array<{
    name: string;
    type: string; // "str", "float", "json", etc.
    path?: string; // For nested fields: "output_parsed.company_name"
  }>;
};

export type FieldMapping = {
  sourceId: string;
  field: string;
};

type VariableMappingInputProps = {
  /** Current mapping value, if mapped to a source */
  mapping?: FieldMapping;
  /** Default/fallback value when not mapped */
  defaultValue?: string;
  /** Callback when mapping changes */
  onMappingChange?: (mapping: FieldMapping | undefined) => void;
  /** Callback when default value changes */
  onDefaultValueChange?: (value: string) => void;
  /** Available sources to map from */
  availableSources: AvailableSource[];
  /** Expected type for this variable (for type mismatch warnings) */
  expectedType?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Whether the input is disabled */
  disabled?: boolean;
};

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
  defaultValue = "",
  onMappingChange,
  onDefaultValueChange,
  availableSources,
  expectedType,
  placeholder = "Enter value or select source...",
  disabled = false,
}: VariableMappingInputProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [inputValue, setInputValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Get display value for the input
  const getDisplayValue = useCallback(() => {
    if (mapping) {
      const source = availableSources.find((s) => s.id === mapping.sourceId);
      if (source) {
        return `${source.name}.${mapping.field}`;
      }
    }
    return inputValue;
  }, [mapping, availableSources, inputValue]);

  // Check if there's a type mismatch
  const getTypeMismatch = useCallback(() => {
    if (!mapping || !expectedType) return false;
    const source = availableSources.find((s) => s.id === mapping.sourceId);
    if (!source) return false;
    const field = source.fields.find((f) => f.name === mapping.field);
    if (!field) return false;
    // Simple type comparison - could be more sophisticated
    return field.type !== expectedType;
  }, [mapping, expectedType, availableSources]);

  // Filter sources based on search query
  const filteredSources = availableSources
    .map((source) => ({
      ...source,
      fields: source.fields.filter((field) =>
        field.name.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    }))
    .filter((source) => source.fields.length > 0);

  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    setSearchQuery(value);

    // If there was a mapping, clear it when user types
    if (mapping && onMappingChange) {
      onMappingChange(undefined);
    }

    if (onDefaultValueChange) {
      onDefaultValueChange(value);
    }
  };

  // Handle field selection
  const handleSelectField = (sourceId: string, fieldName: string) => {
    if (onMappingChange) {
      onMappingChange({ sourceId, field: fieldName });
    }
    setIsOpen(false);
    setSearchQuery("");
  };

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

  const hasTypeMismatch = getTypeMismatch();

  return (
    <Box position="relative" ref={containerRef} width="full">
      <HStack
        background={mapping ? "blue.50" : "gray.50"}
        borderRadius="6px"
        paddingX={2}
        paddingY={1}
        border="1px solid"
        borderColor={hasTypeMismatch ? "orange.300" : mapping ? "blue.200" : "gray.200"}
        _hover={{ borderColor: disabled ? undefined : "gray.400" }}
        cursor={disabled ? "not-allowed" : "text"}
        onClick={() => {
          if (!disabled) {
            setIsOpen(true);
            inputRef.current?.focus();
          }
        }}
      >
        {mapping && (
          <Box flexShrink={0}>
            <SourceTypeIconComponent
              type={
                availableSources.find((s) => s.id === mapping.sourceId)?.type ||
                "entry"
              }
            />
          </Box>
        )}

        <Input
          ref={inputRef}
          value={isOpen ? searchQuery : getDisplayValue()}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          size="sm"
          variant="flushed"
          border="none"
          fontFamily={mapping ? "mono" : undefined}
          fontSize="13px"
          disabled={disabled}
          flex={1}
        />

        {hasTypeMismatch && (
          <AlertTriangle size={14} color="var(--chakra-colors-orange-500)" />
        )}

        <ChevronDown size={14} color="var(--chakra-colors-gray-400)" />
      </HStack>

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
            zIndex={1000}
          >
            {filteredSources.length === 0 ? (
              <Box padding={3}>
                <Text fontSize="sm" color="gray.500">
                  {searchQuery
                    ? "No matching fields found"
                    : "No available sources"}
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
                          _hover={{ background: "blue.50" }}
                          onClick={() => handleSelectField(source.id, field.name)}
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
              </VStack>
            )}
          </Box>
        </Portal>
      )}
    </Box>
  );
};

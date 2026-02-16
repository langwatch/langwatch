import {
  Box,
  Button,
  HStack,
  Input,
  NativeSelect,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Info, Plus, X } from "lucide-react";
import { useCallback, useState } from "react";
import { Menu } from "~/components/ui/menu";
import { Tooltip } from "~/components/ui/tooltip";
import {
  TYPE_LABELS,
  VariableTypeIcon,
} from "~/prompts/components/ui/VariableTypeIcon";
import {
  generateUniqueIdentifier,
  normalizeIdentifier,
} from "~/utils/identifierUtils";
import {
  type AvailableSource,
  type FieldMapping,
  type FieldType,
  VariableMappingInput,
} from "./VariableMappingInput";

// ============================================================================
// Types
// ============================================================================

export type Variable = {
  identifier: string;
  type: FieldType;
};

export type VariablesSectionProps = {
  /** The list of variables (maps to "inputs" in DSL) */
  variables: Variable[];
  /** Callback when variables change */
  onChange: (variables: Variable[]) => void;

  /** Mappings for each variable (keyed by identifier) */
  mappings?: Record<string, FieldMapping>;
  /** Callback when a mapping changes */
  onMappingChange?: (
    identifier: string,
    mapping: FieldMapping | undefined,
  ) => void;
  /** Available sources for mapping */
  availableSources?: AvailableSource[];

  /** Values for each variable (keyed by identifier) - used when showMappings is false */
  values?: Record<string, string>;
  /** Callback when a value changes */
  onValueChange?: (identifier: string, value: string) => void;

  /** Whether to show the mapping UI (false for Prompt Playground) */
  showMappings?: boolean;
  /** Whether variables can be added/removed (false for evaluator fields) */
  canAddRemove?: boolean;
  /** Whether variables are read-only (true for evaluator fields) */
  readOnly?: boolean;
  /** Whether to show the Add button (defaults to canAddRemove) */
  showAddButton?: boolean;

  /** Section title (defaults to "Variables") */
  title?: string;

  /** Set of variable identifiers that are missing required mappings (for highlighting) */
  missingMappingIds?: Set<string>;
  /** Whether to show the validation error message for missing mappings (defaults to true when missingMappingIds is provided) */
  showMissingMappingsError?: boolean;
  /** When true, highlighted fields show yellow background but not "Required" placeholder (for "at least one" validation) */
  optionalHighlighting?: boolean;

  /** Set of variable identifiers that cannot be removed (locked variables) */
  lockedVariables?: Set<string>;
  /** Custom info tooltips for specific variables (identifier -> tooltip text) */
  variableInfo?: Record<string, string>;
  /** Set of variable identifiers whose mapping input is disabled (shows info instead) */
  disabledMappings?: Set<string>;
  /** Disable mapping input */
  isMappingDisabled?: boolean;
};

// ============================================================================
// Main Component
// ============================================================================

export const VariablesSection = ({
  variables,
  onChange,
  mappings = {},
  onMappingChange,
  availableSources = [],
  values = {},
  onValueChange,
  showMappings = true,
  canAddRemove = true,
  readOnly = false,
  showAddButton,
  title = "Variables",
  missingMappingIds = new Set(),
  showMissingMappingsError = true,
  optionalHighlighting = false,
  lockedVariables = new Set(),
  variableInfo = {},
  disabledMappings = new Set(),
  isMappingDisabled = false,
}: VariablesSectionProps) => {
  // Default showAddButton to canAddRemove if not specified
  const shouldShowAddButton = showAddButton ?? canAddRemove;
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleAddVariable = useCallback(
    (type: FieldType = "str") => {
      const existingIdentifiers = variables.map((v) => v.identifier);
      const newIdentifier = generateUniqueIdentifier(
        "input",
        existingIdentifiers,
      );
      onChange([...variables, { identifier: newIdentifier, type }]);
      // Auto-focus the new variable name
      setEditingId(newIdentifier);
    },
    [variables, onChange],
  );

  const handleRemoveVariable = useCallback(
    (identifier: string) => {
      onChange(variables.filter((v) => v.identifier !== identifier));
      // Also remove the mapping if it exists
      if (onMappingChange) {
        onMappingChange(identifier, undefined);
      }
    },
    [variables, onChange, onMappingChange],
  );

  const handleUpdateVariable = useCallback(
    (oldIdentifier: string, updates: Partial<Variable>) => {
      const newIdentifier = updates.identifier
        ? normalizeIdentifier(updates.identifier)
        : oldIdentifier;

      // Check for duplicates
      if (
        updates.identifier &&
        newIdentifier !== oldIdentifier &&
        variables.some((v) => v.identifier === newIdentifier)
      ) {
        // Don't allow duplicate identifiers
        return false;
      }

      onChange(
        variables.map((v) =>
          v.identifier === oldIdentifier
            ? { ...v, ...updates, identifier: newIdentifier }
            : v,
        ),
      );

      // If identifier changed, update the mapping key
      if (
        updates.identifier &&
        newIdentifier !== oldIdentifier &&
        onMappingChange
      ) {
        const existingMapping = mappings[oldIdentifier];
        if (existingMapping) {
          onMappingChange(oldIdentifier, undefined);
          onMappingChange(newIdentifier, existingMapping);
        }
      }

      return true;
    },
    [variables, onChange, mappings, onMappingChange],
  );

  return (
    <VStack align="stretch" gap={3} width="full">
      {/* Header */}
      <HStack width="full">
        <Text
          fontSize="xs"
          fontWeight="bold"
          textTransform="uppercase"
          color="fg.muted"
        >
          {title}
        </Text>
        <Spacer />
        {shouldShowAddButton && !readOnly && (
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button
                size="xs"
                variant="outline"
                data-testid="add-variable-button"
              >
                <Plus size={14} />
                Add
              </Button>
            </Menu.Trigger>
            <Menu.Content portalled={false}>
              {INPUT_TYPE_OPTIONS.map((option) => (
                <Menu.Item
                  key={option.value}
                  value={option.value}
                  onClick={() =>
                    handleAddVariable(option.value as FieldType)
                  }
                >
                  <HStack gap={2}>
                    <VariableTypeIcon type={option.value} size={14} />
                    <Text>{option.label}</Text>
                  </HStack>
                </Menu.Item>
              ))}
            </Menu.Content>
          </Menu.Root>
        )}
      </HStack>

      {/* Variables List */}
      {variables.length === 0 ? (
        <Text fontSize="13px" color="fg.subtle">
          No variables defined
        </Text>
      ) : (
        <VStack align="stretch" gap={2}>
          {variables.map((variable) => {
            const isLocked = lockedVariables.has(variable.identifier);
            const infoTooltip = variableInfo[variable.identifier];
            const isMappingDisabled_internal =
              isMappingDisabled || disabledMappings.has(variable.identifier);

            return (
              <VariableRow
                key={variable.identifier}
                variable={variable}
                mapping={mappings[variable.identifier]}
                availableSources={availableSources}
                showMappings={showMappings}
                canRemove={canAddRemove && !isLocked}
                readOnly={readOnly || isLocked}
                isEditing={editingId === variable.identifier}
                isMissing={missingMappingIds.has(variable.identifier)}
                optionalHighlighting={optionalHighlighting}
                onStartEdit={() =>
                  !isLocked && setEditingId(variable.identifier)
                }
                onEndEdit={() => setEditingId(null)}
                onUpdate={(updates) =>
                  handleUpdateVariable(variable.identifier, updates)
                }
                onRemove={() => handleRemoveVariable(variable.identifier)}
                onMappingChange={
                  onMappingChange
                    ? (mapping) => onMappingChange(variable.identifier, mapping)
                    : undefined
                }
                defaultValue={values[variable.identifier]}
                onDefaultValueChange={
                  onValueChange
                    ? (value) => onValueChange(variable.identifier, value)
                    : undefined
                }
                infoTooltip={infoTooltip}
                isMappingDisabled={isMappingDisabled_internal}
              />
            );
          })}
        </VStack>
      )}

      {/* Validation error for missing mappings */}
      {showMissingMappingsError && showMappings && missingMappingIds.size > 0 && (
        <Text
          data-testid="missing-mappings-error"
          color="red.500"
          fontSize="sm"
        >
          Please map all required fields:{" "}
          {Array.from(missingMappingIds).join(", ")}
        </Text>
      )}
    </VStack>
  );
};

// ============================================================================
// Variable Row Component
// ============================================================================

// Type options for the dropdown - uses shared TYPE_LABELS for consistency
const INPUT_TYPE_OPTIONS = [
  { value: "str", label: TYPE_LABELS.str ?? "Text" },
  { value: "float", label: TYPE_LABELS.float ?? "Number" },
  { value: "bool", label: TYPE_LABELS.bool ?? "Boolean" },
  { value: "image", label: TYPE_LABELS.image ?? "Image" },
  { value: "list", label: TYPE_LABELS.list ?? "List" },
  { value: "dict", label: TYPE_LABELS.dict ?? "Object" },
  { value: "chat_messages", label: TYPE_LABELS.chat_messages ?? "Messages" },
];

type VariableRowProps = {
  variable: Variable;
  mapping?: FieldMapping;
  availableSources: AvailableSource[];
  showMappings: boolean;
  canRemove: boolean;
  readOnly: boolean;
  isEditing: boolean;
  /** Whether this field is missing a required mapping (for highlighting) */
  isMissing?: boolean;
  /** When true, shows yellow background but not "Required" placeholder (for optional fields) */
  optionalHighlighting?: boolean;
  onStartEdit: () => void;
  onEndEdit: () => void;
  onUpdate: (updates: Partial<Variable>) => boolean;
  onRemove: () => void;
  onMappingChange?: (mapping: FieldMapping | undefined) => void;
  defaultValue?: string;
  onDefaultValueChange?: (value: string) => void;
  /** Custom tooltip text to show next to the variable */
  infoTooltip?: string;
  /** Whether the mapping input is disabled (shows info instead) */
  isMappingDisabled?: boolean;
};

const VariableRow = ({
  variable,
  mapping,
  availableSources,
  showMappings,
  canRemove,
  readOnly,
  isEditing,
  isMissing = false,
  optionalHighlighting = false,
  onStartEdit,
  onEndEdit,
  onUpdate,
  onRemove,
  onMappingChange,
  defaultValue,
  onDefaultValueChange,
  infoTooltip,
  isMappingDisabled = false,
}: VariableRowProps) => {
  const [editValue, setEditValue] = useState(variable.identifier);
  const [hasError, setHasError] = useState(false);

  const handleSave = () => {
    if (editValue.trim() === "") {
      setEditValue(variable.identifier);
      onEndEdit();
      return;
    }

    const success = onUpdate({ identifier: editValue });
    if (!success) {
      setHasError(true);
      // Reset after a moment
      setTimeout(() => setHasError(false), 2000);
    } else {
      onEndEdit();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setEditValue(variable.identifier);
      onEndEdit();
    }
  };

  return (
    <HStack gap={2} width="full">
      {/* Type Icon with selector */}
      {readOnly ? (
        <Box flexShrink={0} padding={0}>
          <VariableTypeIcon type={variable.type} size={14} />
        </Box>
      ) : (
        <NativeSelect.Root size="xs" width="30px" marginX={-2} flexShrink={0}>
          <NativeSelect.Field
            value={variable.type}
            onChange={(e) => onUpdate({ type: e.target.value as FieldType })}
            border="1px solid"
            borderColor="transparent"
            borderRadius="lg"
            padding={1}
            paddingRight={5}
            _hover={{ borderColor: "border" }}
            css={{
              // Hide the default text, show only icon
              color: "transparent",
              "& option": { color: "black" },
            }}
            background="transparent"
            cursor="pointer"
          >
            {INPUT_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </NativeSelect.Field>
          {/* Custom indicator with type icon */}
          <Box
            position="absolute"
            left={2}
            top="50%"
            transform="translateY(-50%)"
            pointerEvents="none"
          >
            <VariableTypeIcon type={variable.type} size={14} />
          </Box>
        </NativeSelect.Root>
      )}

      {/* Variable Name */}
      {isEditing && !readOnly ? (
        <Input
          value={editValue}
          onChange={(e) => setEditValue(normalizeIdentifier(e.target.value))}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          size="sm"
          width="100px"
          fontFamily="mono"
          fontSize="13px"
          autoFocus
          borderColor={hasError ? "red.500" : undefined}
          data-testid={`variable-name-input-${variable.identifier}`}
        />
      ) : (
        <HStack gap={1}>
          <Text
            fontFamily="mono"
            fontSize="13px"
            cursor={readOnly ? "default" : "pointer"}
            onClick={readOnly ? undefined : onStartEdit}
            border="1px solid"
            borderColor="transparent"
            paddingX={2}
            paddingY={1}
            marginX={-2}
            marginY={-1}
            borderRadius="lg"
            _hover={readOnly ? undefined : { borderColor: "border" }}
            minWidth="60px"
            data-testid={`variable-name-${variable.identifier}`}
          >
            {variable.identifier}
          </Text>
          {infoTooltip && (
            <Tooltip content={infoTooltip} positioning={{ placement: "top" }}>
              <Box
                color="fg.subtle"
                cursor="help"
                data-testid={`variable-info-${variable.identifier}`}
              >
                <Info size={14} />
              </Box>
            </Tooltip>
          )}
        </HStack>
      )}

      {!isMappingDisabled && (
        <>
          {/* = sign and value/mapping input */}
          <Text color="fg.subtle" fontSize="sm" flexShrink={0}>
            =
          </Text>

          {showMappings ? (
            // Mapping input with source dropdown
            <Box flex={1} minWidth={0}>
              <VariableMappingInput
                mapping={mapping}
                availableSources={availableSources}
                onMappingChange={onMappingChange}
                disabled={readOnly && !onMappingChange}
                placeholder=""
                isMissing={isMissing}
                optionalHighlighting={optionalHighlighting}
              />
            </Box>
          ) : (
            // Simple value input (for Prompt Playground)
            <Input
              value={defaultValue ?? ""}
              onChange={(e) => onDefaultValueChange?.(e.target.value)}
              size="sm"
              flex={1}
              minWidth={0}
              fontFamily="mono"
              fontSize="13px"
              variant="flushed"
              borderColor="border"
            />
          )}
        </>
      )}

      {/* Delete Button */}
      {canRemove && !readOnly && (
        <Tooltip content="Remove variable" positioning={{ placement: "top" }}>
          <Button
            size="xs"
            variant="ghost"
            colorPalette="gray"
            onClick={onRemove}
            flexShrink={0}
            color="fg.subtle"
            data-testid={`remove-variable-${variable.identifier}`}
          >
            <X size={14} />
          </Button>
        </Tooltip>
      )}
    </HStack>
  );
};

export {
  type AvailableSource,
  type FieldMapping,
} from "./VariableMappingInput";

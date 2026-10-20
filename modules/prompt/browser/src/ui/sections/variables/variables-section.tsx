import {
  FieldEditor,
  FieldEditorName,
  FieldEditorRemove,
  FieldEditorRow,
} from "@langwatch/design-system/field-editor";
import { Menu } from "@langwatch/design-system/menu";
import { Button, chakra, HStack, Text, Textarea } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { generateUniqueIdentifier, normalizeIdentifier } from "@langwatch/prompt-contract";
import { Info, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  type AvailableSource,
  type FieldMapping,
  type FieldType,
  type RenderSourceIcon,
  VariableMappingInput,
} from "./variable-mapping-input.tsx";
import { FieldTypeSelect, TYPE_LABELS, VariableTypeIcon } from "./variable-type/index.ts";

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
  onMappingChange?: (identifier: string, mapping: FieldMapping | undefined) => void;
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
  /**
   * Whether to show the validation error message for missing mappings (defaults to true when
   * missingMappingIds is provided)
   */
  showMissingMappingsError?: boolean;
  /**
   * When true, highlighted fields show the missing-highlight background but not the
   * "Required" placeholder (for "at least one" validation)
   */
  optionalHighlighting?: boolean;

  /** Set of variable identifiers that cannot be removed (locked variables) */
  lockedVariables?: Set<string>;
  /** Custom info tooltips for specific variables (identifier -> tooltip text) */
  variableInfo?: Record<string, string>;
  /** Set of variable identifiers whose mapping input is disabled (shows info instead) */
  disabledMappings?: Set<string>;
  /** Disable mapping input */
  isMappingDisabled?: boolean;
  /** Draws a source's icon; the consumer owns the icon set. */
  renderSourceIcon?: RenderSourceIcon;
  /** Lines a literal value opens with (defaults to 1). */
  valueRows?: 1 | 2;
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
  renderSourceIcon,
  valueRows = 1,
}: VariablesSectionProps) => {
  // Default showAddButton to canAddRemove if not specified
  const shouldShowAddButton = showAddButton ?? canAddRemove;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [focusAfterRemove, setFocusAfterRemove] = useState<string | null>(null);

  useEffect(() => {
    if (focusAfterRemove === null) return;
    const frame = requestAnimationFrame(() => {
      const target =
        document.querySelector<HTMLElement>(`[data-testid="${focusAfterRemove}"]`) ??
        document.querySelector<HTMLElement>('[data-testid="add-variable-button"]');
      target?.focus();
      setFocusAfterRemove(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusAfterRemove]);

  const handleAddVariable = useCallback(
    (type: FieldType = "str") => {
      const existingIdentifiers = variables.map((v) => v.identifier);
      const newIdentifier = generateUniqueIdentifier({
        baseName: "input",
        existingIdentifiers,
      });
      onChange([...variables, { identifier: newIdentifier, type }]);
      // Auto-focus the new variable name
      setEditingId(newIdentifier);
    },
    [variables, onChange],
  );

  const handleRemoveVariable = useCallback(
    (identifier: string) => {
      const index = variables.findIndex((v) => v.identifier === identifier);
      const neighbour = variables[index + 1] ?? variables[index - 1];
      setFocusAfterRemove(neighbour ? `variable-name-${neighbour.identifier}` : "");
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
          v.identifier === oldIdentifier ? { ...v, ...updates, identifier: newIdentifier } : v,
        ),
      );

      // If identifier changed, update the mapping key
      if (updates.identifier && newIdentifier !== oldIdentifier && onMappingChange) {
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
    <FieldEditor
      label={title}
      empty={variables.length === 0}
      emptyMessage="No variables defined"
      addAction={
        shouldShowAddButton && !readOnly ? (
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button
                type="button"
                size="xs"
                variant="outline"
                aria-label="Add variable"
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
                  onClick={() => handleAddVariable(option.value as FieldType)}
                >
                  <HStack gap={2}>
                    <VariableTypeIcon type={option.value} size={14} />
                    <Text>{option.label}</Text>
                  </HStack>
                </Menu.Item>
              ))}
            </Menu.Content>
          </Menu.Root>
        ) : undefined
      }
      message={
        showMissingMappingsError && showMappings && missingMappingIds.size > 0 ? (
          <Text data-testid="missing-mappings-error" color="fg.error" fontSize="xs">
            Please map all required fields: {Array.from(missingMappingIds).join(", ")}
          </Text>
        ) : undefined
      }
    >
      <VariableList
        variables={variables}
        mappings={mappings}
        availableSources={availableSources}
        values={values}
        showMappings={showMappings}
        canAddRemove={canAddRemove}
        readOnly={readOnly}
        missingMappingIds={missingMappingIds}
        optionalHighlighting={optionalHighlighting}
        lockedVariables={lockedVariables}
        variableInfo={variableInfo}
        disabledMappings={disabledMappings}
        isMappingDisabled={isMappingDisabled}
        onMappingChange={onMappingChange}
        onValueChange={onValueChange}
        editingId={editingId}
        setEditingId={setEditingId}
        onUpdate={handleUpdateVariable}
        onRemove={handleRemoveVariable}
        renderSourceIcon={renderSourceIcon}
        valueRows={valueRows}
      />
    </FieldEditor>
  );
};

type VariableListProps = Required<
  Pick<
    VariablesSectionProps,
    | "variables"
    | "mappings"
    | "availableSources"
    | "values"
    | "showMappings"
    | "canAddRemove"
    | "readOnly"
    | "missingMappingIds"
    | "optionalHighlighting"
    | "lockedVariables"
    | "variableInfo"
    | "disabledMappings"
    | "isMappingDisabled"
  >
> &
  Pick<
    VariablesSectionProps,
    "onMappingChange" | "onValueChange" | "renderSourceIcon" | "valueRows"
  > & {
    editingId: string | null;
    setEditingId: (identifier: string | null) => void;
    onUpdate: (identifier: string, updates: Partial<Variable>) => boolean;
    onRemove: (identifier: string) => void;
  };

function VariableList({
  variables,
  mappings,
  availableSources,
  values,
  showMappings,
  canAddRemove,
  readOnly,
  missingMappingIds,
  optionalHighlighting,
  lockedVariables,
  variableInfo,
  disabledMappings,
  isMappingDisabled,
  onMappingChange,
  onValueChange,
  editingId,
  setEditingId,
  onUpdate,
  onRemove,
  renderSourceIcon,
  valueRows,
}: VariableListProps) {
  return (
    <>
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
            onStartEdit={() => !isLocked && setEditingId(variable.identifier)}
            onEndEdit={() => setEditingId(null)}
            onUpdate={(updates) => onUpdate(variable.identifier, updates)}
            onRemove={() => onRemove(variable.identifier)}
            onMappingChange={
              onMappingChange
                ? (mapping) => onMappingChange(variable.identifier, mapping)
                : undefined
            }
            defaultValue={values[variable.identifier]}
            onDefaultValueChange={
              onValueChange ? (value) => onValueChange(variable.identifier, value) : undefined
            }
            infoTooltip={infoTooltip}
            isMappingDisabled={isMappingDisabled_internal}
            renderSourceIcon={renderSourceIcon}
            valueRows={valueRows}
          />
        );
      })}
    </>
  );
}

// ============================================================================
// Variable Row Component
// ============================================================================

// Type options for the dropdown - uses shared TYPE_LABELS for consistency
const INPUT_TYPE_OPTIONS = [
  { value: "str", label: TYPE_LABELS.str ?? "Text" },
  { value: "float", label: TYPE_LABELS.float ?? "Number" },
  { value: "bool", label: TYPE_LABELS.bool ?? "Boolean" },
  { value: "image", label: TYPE_LABELS.image ?? "Image" },
  { value: "file", label: TYPE_LABELS.file ?? "File" },
  { value: "list", label: TYPE_LABELS.list ?? "List" },
  { value: "dict", label: TYPE_LABELS.dict ?? "Object" },
  { value: "chat_messages", label: TYPE_LABELS.chat_messages ?? "Messages" },
];

/** One variable row's height: the type select, name, "=" and value share it. */
const ROW_HEIGHT = "32px";

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
  /** Draws a source's icon; the consumer owns the icon set. */
  renderSourceIcon?: RenderSourceIcon;
  valueRows?: 1 | 2;
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
  renderSourceIcon,
  valueRows = 1,
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

  const handleCancel = () => {
    setEditValue(variable.identifier);
    onEndEdit();
  };

  const valueControl = showMappings ? (
    <VariableMappingInput
      mapping={mapping}
      availableSources={availableSources}
      onMappingChange={onMappingChange}
      disabled={readOnly && !onMappingChange}
      placeholder=""
      isMissing={isMissing}
      optionalHighlighting={optionalHighlighting}
      inputTestId={`mapping-input-${variable.identifier}`}
      renderSourceIcon={renderSourceIcon}
    />
  ) : (
    <Textarea
      value={defaultValue ?? ""}
      onChange={(e) => onDefaultValueChange?.(e.target.value)}
      size="sm"
      width="full"
      fontFamily="mono"
      textStyle="bodySm"
      lineHeight="20px"
      paddingY="1.5"
      variant="flushed"
      borderColor="border"
      autoresize
      resize="none"
      rows={valueRows}
      minHeight={ROW_HEIGHT}
      maxHeight="240px"
      data-testid={`variable-value-input-${variable.identifier}`}
    />
  );

  return (
    <FieldEditorRow
      typeControl={
        <FieldTypeSelect
          value={variable.type}
          options={INPUT_TYPE_OPTIONS}
          onChange={(type) => onUpdate({ type: type as FieldType })}
          readOnly={readOnly}
          testId={`variable-type-select-${variable.identifier}`}
        />
      }
      nameControl={
        <FieldEditorName
          value={variable.identifier}
          editing={isEditing && !readOnly}
          draft={editValue}
          readOnly={readOnly}
          invalid={hasError}
          ariaLabel={`Variable name ${variable.identifier}`}
          onStartEdit={onStartEdit}
          onDraftChange={(draft) => setEditValue(normalizeIdentifier(draft))}
          onCommit={handleSave}
          onCancel={handleCancel}
          displayTestId={`variable-name-${variable.identifier}`}
          inputTestId={`variable-name-input-${variable.identifier}`}
        />
      }
      info={
        infoTooltip ? (
          <Tooltip content={infoTooltip} positioning={{ placement: "top" }}>
            <chakra.button
              type="button"
              tabIndex={0}
              aria-label={infoTooltip}
              color="fg.subtle"
              cursor="help"
              flexShrink={0}
              display="inline-flex"
              data-testid={`variable-info-${variable.identifier}`}
            >
              <Info size={14} />
            </chakra.button>
          </Tooltip>
        ) : undefined
      }
      separator={
        <Text color="fg.subtle" fontFamily="mono" textStyle="bodySm">
          =
        </Text>
      }
      valueLabel={showMappings ? "Mapping" : "Value"}
      value={isMappingDisabled ? undefined : valueControl}
      removeAction={
        canRemove && !readOnly ? (
          <FieldEditorRemove
            label={`Remove input variable ${variable.identifier}`}
            tooltip="Remove variable"
            onClick={onRemove}
            data-testid={`remove-variable-${variable.identifier}`}
          />
        ) : undefined
      }
    />
  );
};

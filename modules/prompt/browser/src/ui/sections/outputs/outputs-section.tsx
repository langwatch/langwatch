import { Dialog } from "@langwatch/design-system/dialog";
import {
  FieldEditor,
  FieldEditorName,
  FieldEditorRemove,
  FieldEditorRow,
} from "@langwatch/design-system/field-editor";
import { Menu } from "@langwatch/design-system/menu";
import { Box, Button, HStack, Text, useDisclosure } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import {
  outputsSchema,
  generateUniqueIdentifier,
  normalizeIdentifier,
} from "@langwatch/prompt-contract";
import type { Field } from "@langwatch/workflow-contract";
import Ajv from "ajv";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { LuBraces } from "react-icons/lu";
import { fromZodError } from "zod-validation-error";

import { WorkflowCodeEditor } from "../../elements/workflow/code/workflow-code-editor.tsx";
import { FieldTypeSelect } from "../variables/variable-type/field-type-select.tsx";
import { TYPE_LABELS, VariableTypeIcon } from "../variables/variable-type/variable-type-icon.tsx";

// ============================================================================
// Types
// ============================================================================

/** Output type - uses DSL Field type for consistency */
export type OutputType = Field["type"];

export type Output = {
  identifier: string;
  type: OutputType;
  json_schema?: object;
};

export type OutputsSectionProps = {
  /** The list of outputs */
  outputs: Output[];
  /** Callback when outputs change */
  onChange: (outputs: Output[]) => void;
  /** Whether outputs can be added/removed */
  canAddRemove?: boolean;
  /** Whether outputs are read-only */
  readOnly?: boolean;
  /** Section title */
  title?: string;
  /** Which output types are available (defaults to LLM types: str, float, bool, json_schema) */
  availableTypes?: OutputType[];
};

// ============================================================================
// Constants
// ============================================================================

const ALL_OUTPUT_TYPE_OPTIONS: { value: OutputType; label: string }[] = [
  { value: "str", label: TYPE_LABELS.str ?? "Text" },
  { value: "float", label: TYPE_LABELS.float ?? "Number" },
  { value: "bool", label: TYPE_LABELS.bool ?? "Boolean" },
  { value: "json_schema", label: TYPE_LABELS.json_schema ?? "JSON Schema" },
  { value: "dict", label: TYPE_LABELS.dict ?? "Object" },
  { value: "list", label: TYPE_LABELS.list ?? "List" },
  { value: "image", label: TYPE_LABELS.image ?? "Image" },
];

/** Default types for LLM outputs (with structured output support) */
export const LLM_OUTPUT_TYPES: OutputType[] = ["str", "float", "bool", "json_schema"];

/** Types for code block outputs */
export const CODE_OUTPUT_TYPES: OutputType[] = ["str", "float", "bool", "dict", "list", "image"];

const DEFAULT_JSON_SCHEMA = {
  type: "object",
  properties: {
    result: {
      type: "string",
    },
  },
  required: ["result"],
};

// ============================================================================
// Main Component
// ============================================================================

export const OutputsSection = ({
  outputs,
  onChange,
  canAddRemove = true,
  readOnly = false,
  title = "Outputs",
  availableTypes = LLM_OUTPUT_TYPES,
}: OutputsSectionProps) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [focusAfterRemove, setFocusAfterRemove] = useState<string | null>(null);

  useEffect(() => {
    if (focusAfterRemove === null) return;
    const frame = requestAnimationFrame(() => {
      const target =
        document.querySelector<HTMLElement>(`[data-testid="${focusAfterRemove}"]`) ??
        document.querySelector<HTMLElement>('[data-testid="add-output-button"]');
      target?.focus();
      setFocusAfterRemove(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusAfterRemove]);
  const jsonSchemaDialog = useDisclosure();
  const [editingJsonSchemaIndex, setEditingJsonSchemaIndex] = useState<number | null>(null);

  // Filter type options based on availableTypes prop
  const typeOptions = ALL_OUTPUT_TYPE_OPTIONS.filter((opt) => availableTypes.includes(opt.value));

  const handleAddOutput = useCallback(
    (type: OutputType) => {
      const existingIdentifiers = outputs.map((o) => o.identifier);
      const newIdentifier = generateUniqueIdentifier({
        baseName: "output",
        existingIdentifiers,
      });

      const newOutput: Output = {
        identifier: newIdentifier,
        type,
        ...(type === "json_schema" ? { json_schema: DEFAULT_JSON_SCHEMA } : {}),
      };

      onChange([...outputs, newOutput]);
      setEditingId(newIdentifier);

      // If json_schema, open the dialog
      if (type === "json_schema") {
        setEditingJsonSchemaIndex(outputs.length);
        jsonSchemaDialog.onOpen();
      }
    },
    [outputs, onChange, jsonSchemaDialog],
  );

  const handleRemoveOutput = useCallback(
    (identifier: string) => {
      const index = outputs.findIndex((o) => o.identifier === identifier);
      const neighbour = outputs[index + 1] ?? outputs[index - 1];
      setFocusAfterRemove(neighbour ? `output-name-${neighbour.identifier}` : "");
      onChange(outputs.filter((o) => o.identifier !== identifier));
    },
    [outputs, onChange],
  );

  const handleUpdateOutput = useCallback(
    (oldIdentifier: string, updates: Partial<Output>) => {
      const newIdentifier = updates.identifier
        ? normalizeIdentifier(updates.identifier)
        : oldIdentifier;

      // Check for duplicates
      if (
        updates.identifier &&
        newIdentifier !== oldIdentifier &&
        outputs.some((o) => o.identifier === newIdentifier)
      ) {
        return false;
      }

      onChange(
        outputs.map((o) =>
          o.identifier === oldIdentifier ? { ...o, ...updates, identifier: newIdentifier } : o,
        ),
      );

      return true;
    },
    [outputs, onChange],
  );

  const handleEditJsonSchema = (index: number) => {
    setEditingJsonSchemaIndex(index);
    jsonSchemaDialog.onOpen();
  };

  const handleJsonSchemaChange = (jsonSchema: object) => {
    if (editingJsonSchemaIndex !== null) {
      const output = outputs[editingJsonSchemaIndex];
      if (output) {
        handleUpdateOutput(output.identifier, { json_schema: jsonSchema });
      }
    }
  };

  const currentJsonSchema =
    editingJsonSchemaIndex !== null
      ? (outputs[editingJsonSchemaIndex]?.json_schema ?? DEFAULT_JSON_SCHEMA)
      : DEFAULT_JSON_SCHEMA;

  // Check if we can delete (must have at least one output)
  const canDelete = outputs.length > 1;

  return (
    <FieldEditor
      label={title}
      empty={outputs.length === 0}
      emptyMessage="No outputs defined"
      addAction={
        canAddRemove && !readOnly ? (
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button
                type="button"
                size="xs"
                variant="outline"
                aria-label="Add output"
                data-testid="add-output-button"
              >
                <Plus size={14} />
                Add
              </Button>
            </Menu.Trigger>
            <Menu.Content portalled={false}>
              {typeOptions.map((option) => (
                <Menu.Item
                  key={option.value}
                  value={option.value}
                  onClick={() => handleAddOutput(option.value)}
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
        <JsonSchemaDialog
          open={jsonSchemaDialog.open}
          onClose={() => {
            jsonSchemaDialog.onClose();
            setEditingJsonSchemaIndex(null);
          }}
          value={currentJsonSchema}
          onChange={handleJsonSchemaChange}
        />
      }
    >
      {outputs.map((output, index) => (
        <OutputRow
          key={output.identifier}
          output={output}
          canRemove={canAddRemove && canDelete}
          readOnly={readOnly}
          isEditing={editingId === output.identifier}
          onStartEdit={() => setEditingId(output.identifier)}
          onEndEdit={() => setEditingId(null)}
          onUpdate={(updates) => handleUpdateOutput(output.identifier, updates)}
          onRemove={() => handleRemoveOutput(output.identifier)}
          onEditJsonSchema={() => handleEditJsonSchema(index)}
          typeOptions={typeOptions}
        />
      ))}
    </FieldEditor>
  );
};

// ============================================================================
// Output Row Component
// ============================================================================

type OutputRowProps = {
  output: Output;
  canRemove: boolean;
  readOnly: boolean;
  isEditing: boolean;
  onStartEdit: () => void;
  onEndEdit: () => void;
  onUpdate: (updates: Partial<Output>) => boolean;
  onRemove: () => void;
  onEditJsonSchema: () => void;
  typeOptions: { value: OutputType; label: string }[];
};

function applyOutputTypeChange({
  newType,
  currentType,
  onUpdate,
  onEditJsonSchema,
}: {
  newType: OutputType;
  currentType: OutputType;
  onUpdate: OutputRowProps["onUpdate"];
  onEditJsonSchema: () => void;
}): void {
  if (newType === "json_schema" && currentType !== "json_schema") {
    onUpdate({ type: newType, json_schema: DEFAULT_JSON_SCHEMA });
    onEditJsonSchema();
  } else {
    onUpdate({ type: newType });
  }
}

const OutputRow = ({
  output,
  canRemove,
  readOnly,
  isEditing,
  onStartEdit,
  onEndEdit,
  onUpdate,
  onRemove,
  typeOptions,
  onEditJsonSchema,
}: OutputRowProps) => {
  const [editValue, setEditValue] = useState(output.identifier);
  const [hasError, setHasError] = useState(false);
  const handleSave = () => {
    if (editValue.trim() === "") {
      setEditValue(output.identifier);
      onEndEdit();
      return;
    }

    const success = onUpdate({ identifier: editValue });
    if (!success) {
      setHasError(true);
      setTimeout(() => setHasError(false), 2000);
    } else {
      onEndEdit();
    }
  };

  const handleCancel = () => {
    setEditValue(output.identifier);
    onEndEdit();
  };

  return (
    <FieldEditorRow
      typeControl={
        <FieldTypeSelect
          value={output.type}
          options={typeOptions}
          onChange={(newTypeStr) =>
            applyOutputTypeChange({
              newType: newTypeStr as OutputType,
              currentType: output.type,
              onUpdate,
              onEditJsonSchema,
            })
          }
          readOnly={readOnly}
          testId={`output-type-select-${output.identifier}`}
        />
      }
      nameControl={
        <FieldEditorName
          value={output.identifier}
          editing={isEditing && !readOnly}
          draft={editValue}
          readOnly={readOnly}
          invalid={hasError}
          ariaLabel={`Output name ${output.identifier}`}
          onStartEdit={onStartEdit}
          onDraftChange={(draft) => setEditValue(normalizeIdentifier(draft))}
          onCommit={handleSave}
          onCancel={handleCancel}
          displayTestId={`output-name-${output.identifier}`}
          inputTestId={`output-name-input-${output.identifier}`}
        />
      }
      value={
        output.type === "json_schema" ? (
          <Tooltip content="Edit JSON Schema" positioning={{ placement: "top" }}>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={onEditJsonSchema}
              data-testid={`edit-json-schema-${output.identifier}`}
            >
              <LuBraces size={14} />
              <Text fontSize="xs">JSON Schema</Text>
            </Button>
          </Tooltip>
        ) : undefined
      }
      valueLabel="Schema"
      removeAction={
        !readOnly ? (
          <FieldEditorRemove
            label={`Remove output ${output.identifier}`}
            tooltip={canRemove ? "Remove output" : "At least one output is required"}
            disabled={!canRemove}
            onClick={onRemove}
            data-testid={`remove-output-${output.identifier}`}
          />
        ) : undefined
      }
    />
  );
};

// ============================================================================
// JSON Schema Dialog
// ============================================================================

const ajv = new Ajv();

const checkForJsonSchemaErrors = (jsonSchemaString: string) => {
  try {
    const schema = JSON.parse(jsonSchemaString);
    const valid = ajv.validateSchema(schema);
    if (!valid) {
      return ajv.errorsText();
    }
    const jsonSchemaValidation = outputsSchema.shape.json_schema.safeParse(schema);
    if (!jsonSchemaValidation.success) {
      const validationError = fromZodError(jsonSchemaValidation.error);
      return validationError.message;
    }
    return null;
  } catch (err) {
    return (err as Error).message;
  }
};

const JsonSchemaDialog = ({
  open,
  onClose,
  value,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  value: object;
  onChange: (jsonSchema: object) => void;
}) => {
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string>(JSON.stringify(value, null, 2));

  useEffect(() => {
    const code = JSON.stringify(value, null, 2);
    setCode(code);
    setError(checkForJsonSchemaErrors(code));
  }, [value, open]);

  const checkForErrors = useCallback(
    (code: string) => {
      const error = checkForJsonSchemaErrors(code);
      if (error) {
        setError(error);
      } else {
        setError(null);
      }
    },
    [setError],
  );

  return (
    <Dialog
      open={open}
      onClose={() => {
        const isEdited = JSON.stringify(value, null, 2) !== code;
        if (isEdited && !confirm("Changes will be lost. Are you sure?")) {
          return;
        }
        onClose();
      }}
      title="JSON Schema"
      size="lg"
      ground="card"
      primaryAction={{
        label: "Save",
        onClick: () => {
          if (error) return;
          onChange(JSON.parse(code));
          onClose();
        },
      }}
    >
      <Box height="400px">
        {open && (
          <WorkflowCodeEditor
            code={code}
            setCode={(code: string) => {
              setCode(code);
              checkForErrors(code);
            }}
            onClose={onClose}
            language="json"
            technologies={["json", "json schema"]}
            // A JSON schema names no secrets, so the editor offers none.
            secretNames={[]}
          />
        )}
        {error && <Text role="alert">Error: {error}</Text>}
      </Box>
    </Dialog>
  );
};

import {
  Box,
  Button,
  HStack,
  Input,
  NativeSelect,
  Spacer,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import Ajv from "ajv";
import { Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LuBraces } from "react-icons/lu";
import { fromZodError } from "zod-validation-error";

import { Dialog } from "~/components/ui/dialog";
import { Menu } from "~/components/ui/menu";
import { Tooltip } from "~/components/ui/tooltip";
import { CodeEditor } from "~/optimization_studio/components/code/CodeEditorModal";
import type { Field } from "~/optimization_studio/types/dsl";
import {
  TYPE_LABELS,
  VariableTypeIcon,
} from "~/prompts/components/ui/VariableTypeIcon";
import { outputsSchema } from "~/prompts/schemas";
import {
  generateUniqueIdentifier,
  normalizeIdentifier,
} from "~/utils/identifierUtils";

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

const ALL_OUTPUT_TYPE_OPTIONS: Array<{ value: OutputType; label: string }> = [
  { value: "str", label: TYPE_LABELS.str ?? "Text" },
  { value: "float", label: TYPE_LABELS.float ?? "Number" },
  { value: "bool", label: TYPE_LABELS.bool ?? "Boolean" },
  { value: "json_schema", label: TYPE_LABELS.json_schema ?? "JSON Schema" },
  { value: "dict", label: TYPE_LABELS.dict ?? "Object" },
  { value: "list", label: TYPE_LABELS.list ?? "List" },
  { value: "image", label: TYPE_LABELS.image ?? "Image" },
];

/** Default types for LLM outputs (with structured output support) */
export const LLM_OUTPUT_TYPES: OutputType[] = [
  "str",
  "float",
  "bool",
  "json_schema",
];

/** Types for code block outputs */
export const CODE_OUTPUT_TYPES: OutputType[] = [
  "str",
  "float",
  "bool",
  "dict",
  "list",
  "image",
];

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
  const jsonSchemaDialog = useDisclosure();
  const [editingJsonSchemaIndex, setEditingJsonSchemaIndex] = useState<
    number | null
  >(null);

  // Filter type options based on availableTypes prop
  const typeOptions = ALL_OUTPUT_TYPE_OPTIONS.filter((opt) =>
    availableTypes.includes(opt.value),
  );

  const handleAddOutput = useCallback(
    (type: OutputType) => {
      const existingIdentifiers = outputs.map((o) => o.identifier);
      const newIdentifier = generateUniqueIdentifier(
        "output",
        existingIdentifiers,
      );

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
          o.identifier === oldIdentifier
            ? { ...o, ...updates, identifier: newIdentifier }
            : o,
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
    <VStack align="stretch" gap={3} width="full">
      {/* Header */}
      <HStack width="full">
        <Text fontSize="sm" fontWeight="medium" color="fg.muted">
          {title}
        </Text>
        <Spacer />
        {canAddRemove && !readOnly && (
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button
                size="xs"
                variant="outline"
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
        )}
      </HStack>

      {/* Outputs List */}
      {outputs.length === 0 ? (
        <Text fontSize="13px" color="fg.subtle">
          No outputs defined
        </Text>
      ) : (
        <VStack align="stretch" gap={2}>
          {outputs.map((output, index) => (
            <OutputRow
              key={output.identifier}
              output={output}
              canRemove={canAddRemove && canDelete}
              readOnly={readOnly}
              isEditing={editingId === output.identifier}
              onStartEdit={() => setEditingId(output.identifier)}
              onEndEdit={() => setEditingId(null)}
              onUpdate={(updates) =>
                handleUpdateOutput(output.identifier, updates)
              }
              onRemove={() => handleRemoveOutput(output.identifier)}
              onEditJsonSchema={() => handleEditJsonSchema(index)}
              typeOptions={typeOptions}
            />
          ))}
        </VStack>
      )}

      {/* JSON Schema Dialog */}
      <JsonSchemaDialog
        open={jsonSchemaDialog.open}
        onClose={() => {
          jsonSchemaDialog.onClose();
          setEditingJsonSchemaIndex(null);
        }}
        value={currentJsonSchema}
        onChange={handleJsonSchemaChange}
      />
    </VStack>
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
  typeOptions: Array<{ value: OutputType; label: string }>;
};

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
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing) {
      // Use requestAnimationFrame to ensure DOM is ready after render
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      });
    }
  }, [isEditing]);

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setEditValue(output.identifier);
      onEndEdit();
    }
  };

  return (
    <HStack gap={2} width="full">
      {/* Type Icon with selector */}
      {readOnly ? (
        <Box flexShrink={0} padding={1}>
          <VariableTypeIcon type={output.type} size={14} />
        </Box>
      ) : (
        <NativeSelect.Root size="xs" width="30px" marginX={-2} flexShrink={0}>
          <NativeSelect.Field
            value={output.type}
            onChange={(e) => {
              const newType = e.target.value as OutputType;
              if (newType === "json_schema" && output.type !== "json_schema") {
                onUpdate({ type: newType, json_schema: DEFAULT_JSON_SCHEMA });
                onEditJsonSchema();
              } else {
                onUpdate({ type: newType });
              }
            }}
            border="1px solid"
            borderColor="transparent"
            borderRadius="lg"
            padding={1}
            paddingRight={5}
            _hover={{ borderColor: "border" }}
            css={{
              color: "transparent",
              "& option": { color: "black" },
            }}
            background="transparent"
          >
            {typeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </NativeSelect.Field>
          <Box
            position="absolute"
            left={2}
            top="50%"
            transform="translateY(-50%)"
            pointerEvents="none"
          >
            <VariableTypeIcon type={output.type} size={14} />
          </Box>
        </NativeSelect.Root>
      )}

      {/* Output Name */}
      {isEditing && !readOnly ? (
        <Input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(normalizeIdentifier(e.target.value))}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          size="sm"
          width="100px"
          fontFamily="mono"
          fontSize="13px"
          borderColor={hasError ? "red.500" : undefined}
          data-testid={`output-name-input-${output.identifier}`}
        />
      ) : (
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
          data-testid={`output-name-${output.identifier}`}
        >
          {output.identifier}
        </Text>
      )}

      <Spacer />

      {/* JSON Schema Edit Button */}
      {output.type === "json_schema" && (
        <Tooltip content="Edit JSON Schema" positioning={{ placement: "top" }}>
          <Button
            size="xs"
            variant="ghost"
            onClick={onEditJsonSchema}
            data-testid={`edit-json-schema-${output.identifier}`}
          >
            <LuBraces size={14} />
            <Text fontSize="xs">JSON Schema</Text>
          </Button>
        </Tooltip>
      )}

      {/* Delete Button */}
      {!readOnly && (
        <Tooltip
          content={
            canRemove ? "Remove output" : "At least one output is required"
          }
          positioning={{ placement: "top" }}
        >
          <Button
            size="xs"
            variant="ghost"
            colorPalette="gray"
            onClick={onRemove}
            flexShrink={0}
            color="fg.subtle"
            disabled={!canRemove}
            data-testid={`remove-output-${output.identifier}`}
          >
            <X size={14} />
          </Button>
        </Tooltip>
      )}
    </HStack>
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
    const jsonSchemaValidation =
      outputsSchema.shape.json_schema.safeParse(schema);
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
    checkForErrors(code);
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
    <Dialog.Root
      size="lg"
      open={open}
      onOpenChange={({ open }) => {
        if (!open) {
          if (
            JSON.stringify(value, null, 2) !== code &&
            !confirm("Changes will be lost. Are you sure?")
          ) {
            return;
          }
          onClose();
        }
      }}
    >
      <Dialog.Content margin="64px" background="#272822" color="white">
        <Dialog.Header>
          <Dialog.Title>JSON Schema</Dialog.Title>
        </Dialog.Header>
        <Dialog.CloseTrigger color="white" _hover={{ color: "black" }} />
        <Dialog.Body>
          <Box height="400px">
            {open && (
              <CodeEditor
                code={code}
                setCode={(code) => {
                  setCode(code);
                  checkForErrors(code);
                }}
                onClose={onClose}
                language="json"
                technologies={["json", "json schema"]}
              />
            )}
            {error && <Text>Error: {error}</Text>}
          </Box>
        </Dialog.Body>
        <Dialog.Footer>
          <Button
            onClick={() => {
              onChange(JSON.parse(code));
              onClose();
            }}
            variant="outline"
            color="white"
            colorPalette="white"
            size="lg"
            disabled={!!error}
            _hover={{ color: "black" }}
          >
            Save
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
};

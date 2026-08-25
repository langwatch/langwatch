import {
  Box,
  Button,
  Field,
  HStack,
  IconButton,
  Input,
  NativeSelect,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  type CodeEvaluatorConfig,
  codeEvaluatorOutputFields,
} from "@langwatch/evaluator-contract";
import type { ReactNode } from "react";
import { LuPlus, LuX } from "react-icons/lu";

const FIELD_TYPES = ["str", "float", "bool", "list[str]", "dict"] as const;

const OUTPUT_FIELD_DESCRIPTIONS: Record<string, string> = {
  passed: "Whether the check passed (true or false).",
  score: "A numeric score for the result.",
  label: "A classification label for the result.",
  details: "A human-readable explanation of the result.",
};

export type CodeEvaluatorField = CodeEvaluatorConfig["inputs"][number];

export function validCodeEvaluatorFields(
  fields: CodeEvaluatorField[],
): CodeEvaluatorField[] {
  return fields.filter((field) => field.identifier.trim() !== "");
}

export type CodeEvaluatorEditorProps = {
  name: string;
  code: string;
  inputs: CodeEvaluatorField[];
  onNameChange: (name: string) => void;
  onInputsChange: (inputs: CodeEvaluatorField[]) => void;
  renderCodeEditor: (input: {
    code: string;
    inputs: CodeEvaluatorField[];
    outputs: CodeEvaluatorField[];
  }) => ReactNode;
  renderInputMappings?: (input: {
    inputs: CodeEvaluatorField[];
    onInputsChange: (inputs: CodeEvaluatorField[]) => void;
  }) => ReactNode;
};

/** Presentation for authoring a code evaluator. Persistence stays in the host. */
export function CodeEvaluatorEditor({
  name,
  code,
  inputs,
  onNameChange,
  onInputsChange,
  renderCodeEditor,
  renderInputMappings,
}: CodeEvaluatorEditorProps) {
  const outputs = codeEvaluatorOutputFields.map((field) => ({ ...field }));

  return (
    <>
      <Field.Root required>
        <Field.Label>Name</Field.Label>
        <Input
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="My code evaluator"
          data-testid="code-evaluator-name"
        />
      </Field.Root>

      <Field.Root>
        <Field.Label>Python Code</Field.Label>
        <Field.HelperText margin={0}>
          Define a Python class with a `__call__` method that takes the inputs and returns
          the outputs (passed, score, label or details).
        </Field.HelperText>
        <Box
          width="full"
          height="320px"
          borderWidth="1px"
          borderColor="border"
          borderRadius="md"
          overflow="hidden"
        >
          {renderCodeEditor({
            code,
            inputs: validCodeEvaluatorFields(inputs),
            outputs: validCodeEvaluatorFields(outputs),
          })}
        </Box>
      </Field.Root>

      {renderInputMappings ? (
        renderInputMappings({ inputs, onInputsChange })
      ) : (
        <CodeEvaluatorFieldList fields={inputs} onFieldsChange={onInputsChange} />
      )}

      <CodeEvaluatorOutputContract />
    </>
  );
}

function CodeEvaluatorOutputContract() {
  return (
    <VStack align="stretch" gap={2}>
      <Text fontSize="sm" fontWeight="semibold">
        Outputs
      </Text>
      <Text fontSize="xs" color="fg.muted">
        Return a dictionary from your function with any of these fields. Whichever you
        return become the evaluation result.
      </Text>
      <VStack
        align="stretch"
        gap={1.5}
        borderWidth="1px"
        borderColor="border"
        borderRadius="md"
        padding={3}
      >
        {codeEvaluatorOutputFields.map((field) => (
          <HStack key={field.identifier} gap={2} align="baseline">
            <Text
              fontSize="sm"
              fontFamily="mono"
              fontWeight="medium"
              data-testid={`code-evaluator-output-field-${field.identifier}`}
            >
              {field.identifier}
            </Text>
            <Text fontSize="xs" color="fg.muted" fontFamily="mono">
              {field.type}
            </Text>
            <Text fontSize="xs" color="fg.muted">
              {OUTPUT_FIELD_DESCRIPTIONS[field.identifier]}
            </Text>
          </HStack>
        ))}
      </VStack>
    </VStack>
  );
}

function CodeEvaluatorFieldList({
  fields,
  onFieldsChange,
}: {
  fields: CodeEvaluatorField[];
  onFieldsChange: (fields: CodeEvaluatorField[]) => void;
}) {
  return (
    <VStack align="stretch" gap={2}>
      <HStack justify="space-between">
        <Text fontSize="sm" fontWeight="semibold">
          Inputs
        </Text>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => onFieldsChange([...fields, { identifier: "", type: "str" }])}
          data-testid="code-evaluator-input-add"
        >
          <LuPlus size={14} /> Add
        </Button>
      </HStack>

      {fields.map((field, index) => (
        <HStack key={index} gap={2}>
          <Input
            size="sm"
            value={field.identifier}
            placeholder="identifier"
            onChange={(event) =>
              onFieldsChange(
                fields.map((candidate, candidateIndex) =>
                  candidateIndex === index
                    ? { ...candidate, identifier: event.target.value }
                    : candidate,
                ),
              )
            }
            data-testid={`code-evaluator-input-identifier-${index}`}
          />
          <NativeSelect.Root size="sm" width="140px">
            <NativeSelect.Field
              value={field.type}
              onChange={(event) =>
                onFieldsChange(
                  fields.map((candidate, candidateIndex) =>
                    candidateIndex === index
                      ? { ...candidate, type: event.target.value }
                      : candidate,
                  ),
                )
              }
            >
              {FIELD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
          <IconButton
            size="sm"
            variant="ghost"
            aria-label={`Remove inputs ${field.identifier}`}
            onClick={() =>
              onFieldsChange(
                fields.filter((_, candidateIndex) => candidateIndex !== index),
              )
            }
            disabled={fields.length <= 1}
          >
            <LuX size={14} />
          </IconButton>
        </HStack>
      ))}
    </VStack>
  );
}

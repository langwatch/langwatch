import { Box, Text, Textarea, VStack } from "@chakra-ui/react";
import type { Field } from "~/optimization_studio/types/dsl";

export type BodyTemplateEditorProps = {
  value: string;
  onChange: (value: string) => void;
  availableVariables: Field[];
  disabled?: boolean;
};

/**
 * JSON body template editor with variable interpolation hints.
 * Variables are referenced using mustache syntax: {{variable_name}}
 */
export function BodyTemplateEditor({
  value,
  onChange,
  availableVariables,
  disabled = false,
}: BodyTemplateEditorProps) {
  const variableHints = availableVariables
    .map((v) => `{{${v.identifier}}}`)
    .join(", ");

  return (
    <VStack align="stretch" gap={2} width="full">
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`{
  "messages": {{messages}},
  "context": {{context}}
}`}
        fontFamily="mono"
        fontSize="13px"
        minHeight="150px"
        disabled={disabled}
        resize="vertical"
      />
      {availableVariables.length > 0 && (
        <Text fontSize="xs" color="gray.500">
          Available variables: {variableHints}
        </Text>
      )}
    </VStack>
  );
}

import { Box, Code, Text, Textarea, VStack } from "@chakra-ui/react";

/**
 * Standard variables available for HTTP agent body templates.
 * These are provided at runtime by the Scenario/Workflow execution.
 */
export const STANDARD_AGENT_VARIABLES = [
  { name: "input", description: "The user's input message to the agent" },
  {
    name: "threadId",
    description: "Unique identifier for the conversation thread",
  },
  { name: "messages", description: "Array of chat messages in OpenAI format" },
] as const;

export type BodyTemplateEditorProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

export function BodyTemplateEditor({
  value,
  onChange,
  disabled = false,
}: BodyTemplateEditorProps) {
  return (
    <VStack align="stretch" gap={3} width="full">
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`{
  "thread_id": "{{threadId}}",
  "messages": {{messages}}
}`}
        fontFamily="mono"
        fontSize="13px"
        minHeight="180px"
        disabled={disabled}
        resize="vertical"
        data-testid="body-template-editor"
      />
      <Box
        padding={3}
        bg="bg.subtle"
        borderRadius="md"
        borderWidth="1px"
        borderColor="border"
      >
        <Text
          fontSize="xs"
          fontWeight="medium"
          color="fg.muted"
          marginBottom={2}
        >
          Available Variables
        </Text>
        <VStack align="stretch" gap={1}>
          {STANDARD_AGENT_VARIABLES.map((v) => (
            <Text key={v.name} fontSize="xs">
              <Code fontSize="xs" colorPalette="blue">
                {`{{${v.name}}}`}
              </Code>{" "}
              — {v.description}
            </Text>
          ))}
        </VStack>
      </Box>
    </VStack>
  );
}

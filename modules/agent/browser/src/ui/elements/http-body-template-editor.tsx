import { Box, Code, Text, VStack } from "@langwatch/design-system/primitives";

import { httpBodyLanguage } from "../../model/http-body-language.ts";
import { HttpBodyCodeEditor } from "./http-body-code-editor.tsx";

/**
 * Standard variables available for HTTP agent body templates.
 * These are provided at runtime by the Scenario/Workflow execution.
 */
export const STANDARD_HTTP_AGENT_VARIABLES = [
  { name: "input", description: "The user's input message to the agent" },
  {
    name: "threadId",
    description: "Unique identifier for the conversation thread",
  },
  { name: "messages", description: "Array of chat messages in OpenAI format" },
  {
    name: "session",
    description:
      "The value your endpoint returned at the session path on the previous turn of this conversation, empty on the first turn",
  },
  {
    name: "params.NAME",
    description: "A parameter the running scenario declares, resolved for this run",
  },
] as const;

export type BodyTemplateEditorProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** The request headers; Content-Type picks the highlight language. */
  headers?: { key: string; value: string }[];
};

export function BodyTemplateEditor({
  value,
  onChange,
  disabled = false,
  headers,
}: BodyTemplateEditorProps) {
  return (
    <VStack align="stretch" gap={3} width="full">
      <HttpBodyCodeEditor
        value={value}
        onChange={onChange}
        disabled={disabled}
        language={httpBodyLanguage({ headers })}
      />
      <Box padding={3} bg="bg.subtle" borderRadius="md" borderWidth="1px" borderColor="border">
        <Text fontSize="xs" fontWeight="medium" color="fg.muted" marginBottom={2}>
          Available Variables
        </Text>
        <VStack align="stretch" gap={1}>
          {STANDARD_HTTP_AGENT_VARIABLES.map((v) => (
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

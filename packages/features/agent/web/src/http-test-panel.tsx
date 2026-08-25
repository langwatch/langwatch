import {
  Alert,
  Box,
  Button,
  Code,
  Field,
  HStack,
  Input,
  Separator,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { AlertCircle, Play } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
  messagesToJson,
  TestMessagesBuilder,
  type TestMessage,
} from "./http-test-messages-builder";
import { HttpTestRequestPreview } from "./http-test-request-preview";
import { HttpTestResponseDisplay } from "./http-test-response-display";
import type { HttpTestErrorExplanationPort, HttpTestResult } from "./http-test.types";

const DEFAULT_THREAD_ID = "test-thread-123";
const DEFAULT_MESSAGES: TestMessage[] = [{ role: "user", content: "Hello" }];

export type { HttpTestErrorExplanationPort, HttpTestResult } from "./http-test.types";

export type HttpTestPanelProps = {
  /** Runs the request with template variables, so the engine renders the body. */
  onTest: (templateVariables: Record<string, unknown>) => Promise<HttpTestResult>;
  disabled?: boolean;
  url?: string;
  method?: string;
  headers?: Array<{ key: string; value: string }>;
  outputPath?: string;
  bodyTemplate?: string;
  explainError?: HttpTestErrorExplanationPort;
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Previews a body template so invalid JSON is caught before sending. */
export function renderTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(
      new RegExp(`\\{\\{\\s*${escapeRegExp(key)}\\s*\\}\\}`, "g"),
      value,
    );
  }
  return result;
}

export { formatDuration, getStatusColor } from "./http-test-response-display";

export function HttpTestPanel({
  onTest,
  disabled = false,
  url,
  method,
  headers,
  outputPath,
  bodyTemplate,
  explainError,
}: HttpTestPanelProps) {
  const [threadId, setThreadId] = useState(DEFAULT_THREAD_ID);
  const [messages, setMessages] = useState<TestMessage[]>(DEFAULT_MESSAGES);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<HttpTestResult | null>(null);

  const messagesJson = useMemo(() => messagesToJson(messages), [messages]);
  const renderedBody = useMemo(() => {
    if (!bodyTemplate) return "{}";
    return renderTemplate(bodyTemplate, { threadId, messages: messagesJson });
  }, [bodyTemplate, messagesJson, threadId]);

  const bodyValidation = useMemo(() => {
    try {
      JSON.parse(renderedBody);
      return { valid: true, error: null };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : "Invalid JSON",
      };
    }
  }, [renderedBody]);

  const headerValidation = useMemo(() => {
    if (!headers) return { valid: true, errors: [] as string[] };

    const errors: string[] = [];
    for (const header of headers) {
      const trimmedKey = header.key.trim();
      if (header.key !== trimmedKey) {
        errors.push(`Header "${header.key}" has leading/trailing whitespace`);
      }
      if (!trimmedKey) errors.push("Empty header name");
    }
    return { valid: errors.length === 0, errors };
  }, [headers]);

  const handleTest = useCallback(async () => {
    setIsLoading(true);
    setResult(null);
    try {
      const response = await onTest({ threadId, messages });
      setResult(response);
    } catch (error) {
      setResult({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsLoading(false);
    }
  }, [messages, onTest, threadId]);

  return (
    <VStack align="stretch" gap={4} width="full">
      <VStack align="stretch" gap={4}>
        <Field.Root>
          <HStack width="full">
            <Field.Label fontSize="xs">
              <Code fontSize="xs">{"{{threadId}}"}</Code>
            </Field.Label>
            <Input
              value={threadId}
              onChange={(event) => setThreadId(event.target.value)}
              placeholder="test-thread-123"
              size="sm"
              fontFamily="mono"
              fontSize="sm"
            />
          </HStack>
        </Field.Root>

        <TestMessagesBuilder
          messages={messages}
          onChange={setMessages}
          disabled={disabled}
        />
      </VStack>

      <Separator />
      <HttpTestRequestPreview
        url={url}
        method={method}
        headers={headers}
        body={renderedBody}
      />
      <Separator />

      {!bodyValidation.valid && (
        <Alert.Root status="error">
          <Alert.Indicator>
            <AlertCircle size={16} />
          </Alert.Indicator>
          <Alert.Content>
            <Alert.Title>Invalid JSON in body template</Alert.Title>
            <Alert.Description fontFamily="mono" fontSize="sm">
              {bodyValidation.error /* no-raw-error-toast-ok */}
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}

      {!headerValidation.valid && (
        <Alert.Root status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Header Issues</Alert.Title>
            <Alert.Description>
              <VStack align="start" gap={1}>
                {headerValidation.errors.map((error, index) => (
                  <Text key={`${error}-${index}`} fontSize="sm">
                    {error}
                  </Text>
                ))}
              </VStack>
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}

      {outputPath && (
        <Box fontSize="sm" color="fg.muted">
          <Text>
            Output will be extracted using JSONPath:{" "}
            <Code fontSize="sm">{outputPath}</Code>
          </Text>
        </Box>
      )}

      <HStack justify="flex-end">
        <Button
          colorPalette="blue"
          onClick={handleTest}
          disabled={disabled || isLoading || !url || !bodyValidation.valid}
          size="sm"
        >
          {isLoading ? <Spinner size="sm" /> : <Play size={16} />}
          Send Request
        </Button>
      </HStack>

      {result && <HttpTestResponseDisplay result={result} explainError={explainError} />}
    </VStack>
  );
}

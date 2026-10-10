import {
  type HttpTestErrorExplanation,
  type HttpTestResult,
  messagesToJson,
  type TestMessage,
} from "@langwatch/agent-contract/http-test";
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
} from "@langwatch/design-system/primitives";
import { AlertCircle, Play } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { TestMessagesBuilder } from "../blocks/http-test-messages-builder.tsx";
import { HttpTestRequestPreview } from "../blocks/http-test-request-preview.tsx";
import { HttpTestResponseDisplay } from "../blocks/http-test-response-display.tsx";
import { HttpJsonPathText } from "../elements/http-json-path-text.tsx";

const DEFAULT_THREAD_ID = "test-thread-123";
const DEFAULT_MESSAGES: TestMessage[] = [{ role: "user", content: "Hello" }];

export type HttpTestPanelProps = {
  /** Runs the request with template variables, so the engine renders the body. */
  onTest: (templateVariables: Record<string, unknown>) => Promise<HttpTestResult>;
  disabled?: boolean;
  url?: string;
  method?: string;
  headers?: { key: string; value: string }[];
  outputPath?: string;
  bodyTemplate?: string;
  explainError?: HttpTestErrorExplanation;
  /** Fired with each test result, so the output path field can check itself against it. */
  onResult?: (result: HttpTestResult) => void;
  /** Moves focus to the field that sets `outputPath`. */
  onEditOutputPath?: () => void;
  /** The shape the path is checked against, when one is known. */
  shape?: unknown;
  shapeIsSample?: boolean;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Previews a body template so invalid JSON is caught before sending. */
export function renderTemplate(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{\\s*${escapeRegExp(key)}\\s*\\}\\}`, "g"), value);
  }
  return result;
}

export function HttpTestPanel({
  onTest,
  disabled = false,
  url,
  method,
  headers,
  outputPath,
  bodyTemplate,
  explainError,
  onResult,
  onEditOutputPath,
  shape,
  shapeIsSample = false,
}: HttpTestPanelProps) {
  const {
    threadId,
    setThreadId,
    messages,
    setMessages,
    isLoading,
    result,
    renderedBody,
    bodyValidation,
    headerValidation,
    handleTest,
  } = useHttpTestPanel({ onTest, bodyTemplate, headers, onResult });

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

        <TestMessagesBuilder messages={messages} onChange={setMessages} disabled={disabled} />
      </VStack>

      <Separator />
      <HttpTestRequestPreview url={url} method={method} headers={headers} body={renderedBody} />
      <Separator />

      {!bodyValidation.valid && (
        <Alert.Root status="error">
          <Alert.Indicator>
            <AlertCircle size={16} />
          </Alert.Indicator>
          <Alert.Content>
            <Alert.Title>Invalid JSON in body template</Alert.Title>
            <Alert.Description fontFamily="mono">
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
            Output is extracted using JSONPath <HttpJsonPathText path={outputPath} shape={shape} anyIndex={shapeIsSample} />
            {onEditOutputPath && (
              <>
                {". "}
                <Button
                  variant="plain"
                  size="xs"
                  colorPalette="blue"
                  onClick={onEditOutputPath}
                  data-testid="edit-output-path"
                >
                  Change the path
                </Button>
              </>
            )}
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

      {result && <HttpTestResponseDisplay result={result} explainError={explainError} outputPath={outputPath} />}
    </VStack>
  );
}

function validateBody(renderedBody: string) {
  try {
    JSON.parse(renderedBody);
    return { valid: true, error: null };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : "Invalid JSON" };
  }
}

function validateHeaders(headers: HttpTestPanelProps["headers"]) {
  const errors: string[] = [];
  for (const header of headers ?? []) {
    const trimmedKey = header.key.trim();
    if (header.key !== trimmedKey)
      errors.push(`Header "${header.key}" has leading/trailing whitespace`);
    if (!trimmedKey) errors.push("Empty header name");
  }
  return { valid: errors.length === 0, errors };
}

function useHttpTestPanel({ onTest, bodyTemplate, headers, onResult }: HttpTestPanelProps) {
  const [threadId, setThreadId] = useState(DEFAULT_THREAD_ID);
  const [messages, setMessages] = useState<TestMessage[]>(DEFAULT_MESSAGES);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<HttpTestResult | null>(null);

  const messagesJson = useMemo(() => messagesToJson(messages), [messages]);
  const renderedBody = useMemo(() => {
    if (!bodyTemplate) return "{}";
    return renderTemplate(bodyTemplate, { threadId, messages: messagesJson });
  }, [bodyTemplate, messagesJson, threadId]);

  const bodyValidation = useMemo(() => validateBody(renderedBody), [renderedBody]);
  const headerValidation = useMemo(() => validateHeaders(headers), [headers]);

  const handleTest = useCallback(async () => {
    setIsLoading(true);
    setResult(null);
    try {
      const response = await onTest({ threadId, messages });
      setResult(response);
      onResult?.(response);
    } catch (error) {
      setResult({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsLoading(false);
    }
  }, [messages, onResult, onTest, threadId]);

  return {
    threadId,
    setThreadId,
    messages,
    setMessages,
    isLoading,
    result,
    renderedBody,
    bodyValidation,
    headerValidation,
    handleTest,
  };
}

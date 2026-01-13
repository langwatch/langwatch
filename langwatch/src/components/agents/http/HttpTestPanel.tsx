import {
  Alert,
  Badge,
  Box,
  Button,
  Code,
  Collapsible,
  Field,
  HStack,
  Input,
  Separator,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";

import {
  Play,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Clock,
  AlertCircle,
} from "lucide-react";
import { useState, useCallback, useMemo } from "react";
import { Tooltip } from "~/components/ui/tooltip";
import {
  TestMessagesBuilder,
  messagesToJson,
  type TestMessage,
} from "./TestMessagesBuilder";

const DEFAULT_THREAD_ID = "test-thread-123";
const DEFAULT_MESSAGES: TestMessage[] = [{ role: "user", content: "Hello" }];

export type HttpTestResult = {
  success: boolean;
  response?: unknown;
  extractedOutput?: string;
  error?: string;
  status?: number;
  statusText?: string;
  duration?: number;
  responseHeaders?: Record<string, string>;
};

export type HttpTestPanelProps = {
  onTest: (requestBody: string) => Promise<HttpTestResult>;
  disabled?: boolean;
  /** Current URL being tested (for preview) */
  url?: string;
  /** Current HTTP method (for preview) */
  method?: string;
  /** Current headers (for preview, without sensitive values) */
  headers?: Array<{ key: string; value: string }>;
  /** Current output path (for preview) */
  outputPath?: string;
  /** Body template with {{variables}} */
  bodyTemplate?: string;
};

/**
 * Renders a body template by replacing {{variable}} placeholders
 */
export function renderTemplate(
  template: string,
  variables: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  return result;
}

/**
 * Formats duration in human-readable form
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Returns color for HTTP status code
 */
export function getStatusColor(status: number): string {
  if (status >= 200 && status < 300) return "green";
  if (status >= 300 && status < 400) return "blue";
  if (status >= 400 && status < 500) return "orange";
  return "red";
}

/**
 * CopyButton - Small button to copy text to clipboard
 */
function CopyButton({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Tooltip content={copied ? "Copied!" : label}>
      <Button
        variant="ghost"
        size="xs"
        onClick={handleCopy}
        padding={1}
        minWidth="auto"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </Button>
    </Tooltip>
  );
}

/**
 * CollapsibleSection - Reusable collapsible section with header
 */
function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
  badge,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  badge?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible.Root open={open} onOpenChange={({ open }) => setOpen(open)}>
      <Collapsible.Trigger asChild>
        <HStack gap={2} width="full" mb={2}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Text fontSize="sm" fontWeight="medium">
            {title}
          </Text>
          {badge}
        </HStack>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <Box paddingLeft={6} paddingY={2}>
          {children}
        </Box>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

/**
 * RequestPreview - Shows what will be sent
 */
function RequestPreview({
  url,
  method,
  headers,
  body,
}: {
  url?: string;
  method?: string;
  headers?: Array<{ key: string; value: string }>;
  body: string;
}) {
  return (
    <CollapsibleSection title="Request Preview" defaultOpen>
      <VStack align="stretch" gap={2} fontSize="sm">
        <HStack>
          <Badge colorPalette="blue">{method ?? "POST"}</Badge>
          <Text fontFamily="mono" fontSize="xs" wordBreak="break-all">
            {url ?? "No URL configured"}
          </Text>
        </HStack>
        {headers && headers.length > 0 && (
          <Box>
            <Text fontWeight="medium" fontSize="xs" color="gray.600">
              Headers:
            </Text>
            <Box
              as="pre"
              fontSize="xs"
              fontFamily="mono"
              bg="gray.50"
              padding={2}
              borderRadius="md"
              overflow="auto"
            >
              {headers.map((h) => `${h.key}: ${h.value}`).join("\n")}
            </Box>
          </Box>
        )}
        <Box>
          <HStack justify="space-between">
            <Text fontWeight="medium" fontSize="xs" color="gray.600">
              Body (rendered):
            </Text>
            <CopyButton text={body} label="Copy body" />
          </HStack>
          <Box
            as="pre"
            fontSize="xs"
            fontFamily="mono"
            bg="gray.50"
            padding={2}
            borderRadius="md"
            overflow="auto"
            maxHeight="150px"
            whiteSpace="pre-wrap"
          >
            {body}
          </Box>
        </Box>
      </VStack>
    </CollapsibleSection>
  );
}

/**
 * ResponseDisplay - Shows the response with all details
 */
function ResponseDisplay({ result }: { result: HttpTestResult }) {
  const responseString =
    typeof result.response === "string"
      ? result.response
      : JSON.stringify(result.response, null, 2);

  return (
    <VStack align="stretch" gap={3}>
      {/* Status Bar */}
      {(result.status !== undefined ||
        result.duration !== undefined ||
        responseString) && (
        <HStack
          justify="space-between"
          padding={3}
          bg={result.success ? "green.50" : "red.50"}
          borderRadius="md"
          borderWidth="1px"
          borderColor={result.success ? "green.200" : "red.200"}
        >
          <HStack gap={3}>
            {result.status !== undefined && (
              <Badge colorPalette={getStatusColor(result.status)} size="lg">
                {result.status} {result.statusText ?? ""}
              </Badge>
            )}
            {result.duration !== undefined && (
              <HStack gap={1} color="gray.600" fontSize="sm">
                <Clock size={14} />
                <Text>{formatDuration(result.duration)}</Text>
              </HStack>
            )}
          </HStack>
          {responseString && (
            <CopyButton text={responseString} label="Copy response" />
          )}
        </HStack>
      )}

      {/* Error Message */}
      {result.error && (
        <Alert.Root status="error">
          <Alert.Indicator>
            <AlertCircle size={16} />
          </Alert.Indicator>
          <Alert.Content>
            <Alert.Title>Error</Alert.Title>
            <Alert.Description fontFamily="mono" fontSize="sm">
              {result.error}
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}

      {/* Response Headers */}
      {result.responseHeaders &&
        Object.keys(result.responseHeaders).length > 0 && (
          <CollapsibleSection title="Response Headers">
            <Box
              as="pre"
              fontSize="xs"
              fontFamily="mono"
              bg="gray.50"
              padding={2}
              borderRadius="md"
              overflow="auto"
            >
              {Object.entries(result.responseHeaders)
                .map(([key, value]) => `${key}: ${value}`)
                .join("\n")}
            </Box>
          </CollapsibleSection>
        )}

      {/* Response Body */}
      {result.response !== undefined && (
        <CollapsibleSection title="Response Body" defaultOpen={true}>
          <Box
            as="pre"
            fontSize="xs"
            fontFamily="mono"
            bg="gray.50"
            padding={3}
            borderRadius="md"
            overflow="auto"
            maxHeight="300px"
            whiteSpace="pre-wrap"
            wordBreak="break-word"
          >
            {responseString}
          </Box>
        </CollapsibleSection>
      )}

      {/* Extracted Output */}
      {result.extractedOutput !== undefined && (
        <Box
          padding={3}
          bg="blue.50"
          borderRadius="md"
          borderWidth="1px"
          borderColor="blue.200"
        >
          <HStack justify="space-between" marginBottom={2}>
            <Text fontSize="sm" fontWeight="medium" color="blue.700">
              Extracted Output (JSONPath)
            </Text>
            <CopyButton
              text={result.extractedOutput}
              label="Copy extracted output"
            />
          </HStack>
          <Box
            as="pre"
            fontSize="sm"
            fontFamily="mono"
            whiteSpace="pre-wrap"
            wordBreak="break-word"
          >
            {result.extractedOutput}
          </Box>
        </Box>
      )}

      {/* JSONPath extraction failed warning */}
      {result.success &&
        result.response !== undefined &&
        result.extractedOutput === undefined && (
          <Alert.Root status="warning">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>JSONPath extraction returned no results</Alert.Title>
              <Alert.Description>
                Check that your output path matches the response structure.
              </Alert.Description>
            </Alert.Content>
          </Alert.Root>
        )}
    </VStack>
  );
}

/**
 * Test panel for HTTP agents.
 * Provides comprehensive request/response information for debugging.
 */
export function HttpTestPanel({
  onTest,
  disabled = false,
  url,
  method,
  headers,
  outputPath,
  bodyTemplate,
}: HttpTestPanelProps) {
  // Test variable values
  const [threadId, setThreadId] = useState(DEFAULT_THREAD_ID);
  const [messages, setMessages] = useState<TestMessage[]>(DEFAULT_MESSAGES);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<HttpTestResult | null>(null);

  // Convert messages to JSON string for template
  const messagesJson = useMemo(() => messagesToJson(messages), [messages]);

  // Render the body template with current variable values
  const renderedBody = useMemo(() => {
    if (!bodyTemplate) return "{}";
    return renderTemplate(bodyTemplate, {
      threadId,
      messages: messagesJson,
    });
  }, [bodyTemplate, threadId, messagesJson]);

  // Validate rendered body is valid JSON
  const bodyValidation = useMemo(() => {
    try {
      JSON.parse(renderedBody);
      return { valid: true, error: null };
    } catch (e) {
      return {
        valid: false,
        error: e instanceof Error ? e.message : "Invalid JSON",
      };
    }
  }, [renderedBody]);

  // Validate headers
  const headerValidation = useMemo(() => {
    if (!headers) return { valid: true, errors: [] };
    const errors: string[] = [];
    for (const h of headers) {
      const trimmedKey = h.key.trim();
      if (h.key !== trimmedKey) {
        errors.push(`Header "${h.key}" has leading/trailing whitespace`);
      }
      if (!trimmedKey) {
        errors.push("Empty header name");
      }
    }
    return { valid: errors.length === 0, errors };
  }, [headers]);

  const handleTest = useCallback(async () => {
    setIsLoading(true);
    setResult(null);
    try {
      const response = await onTest(renderedBody);
      setResult(response);
    } catch (err) {
      setResult({
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsLoading(false);
    }
  }, [renderedBody, onTest]);

  return (
    <VStack align="stretch" gap={4} width="full">
      <VStack align="stretch" gap={4}>
        <Field.Root>
          <HStack width="full">
            <Field.Label fontSize="xs">
              <Code fontSize="xs">{`{{threadId}}`}</Code>
            </Field.Label>
            <Input
              value={threadId}
              onChange={(e) => setThreadId(e.target.value)}
              placeholder="test-thread-123"
              size="sm"
              fontFamily="mono"
              fontSize="sm"
            />
          </HStack>
        </Field.Root>

        {/* Messages Builder */}
        <TestMessagesBuilder
          messages={messages}
          onChange={setMessages}
          disabled={disabled}
        />
      </VStack>

      <Separator />

      {/* Request Preview */}
      <RequestPreview
        url={url}
        method={method}
        headers={headers}
        body={renderedBody}
      />

      <Separator />

      {/* Validation Errors */}
      {!bodyValidation.valid && (
        <Alert.Root status="error">
          <Alert.Indicator>
            <AlertCircle size={16} />
          </Alert.Indicator>
          <Alert.Content>
            <Alert.Title>Invalid JSON in body template</Alert.Title>
            <Alert.Description fontFamily="mono" fontSize="sm">
              {bodyValidation.error}
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
                {headerValidation.errors.map((err, i) => (
                  <Text key={i} fontSize="sm">
                    {err}
                  </Text>
                ))}
              </VStack>
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}

      {/* Output Path Info */}
      {outputPath && (
        <Box fontSize="sm" color="gray.600">
          <Text>
            Output will be extracted using JSONPath:{" "}
            <Code fontSize="sm">{outputPath}</Code>
          </Text>
        </Box>
      )}

      {/* Test Button */}
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

      {/* Result Display */}
      {result && <ResponseDisplay result={result} />}
    </VStack>
  );
}

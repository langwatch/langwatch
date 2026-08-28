import { Alert, Badge, Box, HStack, Text, VStack } from "@chakra-ui/react";
import { AlertCircle, Clock } from "lucide-react";
import { CollapsibleSection, CopyButton } from "../elements/http-test-components";
import {
  type HttpTestErrorExplanationPort,
  type HttpTestResult,
} from "../../model/http-test.types";

export function getStatusColor(status: number): string {
  if (status >= 200 && status < 300) return "green";
  if (status >= 300 && status < 400) return "blue";
  if (status >= 400 && status < 500) return "orange";
  return "red";
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function TestFailure({
  result,
  explainError,
}: {
  result: HttpTestResult;
  explainError?: HttpTestErrorExplanationPort;
}) {
  const explanation = explainError?.({
    errorCode: result.errorCode,
    error: result.error,
  }) ?? {
    title: "The request failed",
    description: void 0,
  };

  return (
    <Alert.Root status="error">
      <Alert.Indicator>
        <AlertCircle size={16} />
      </Alert.Indicator>
      <Alert.Content>
        <Alert.Title>{explanation.title}</Alert.Title>
        <Alert.Description>
          <VStack align="start" gap={1}>
            {explanation.description && <Text fontSize="sm">{explanation.description}</Text>}
            {result.error && (
              <Text fontFamily="mono" fontSize="xs" color="fg.muted">
                {result.error /* no-raw-error-toast-ok */}
              </Text>
            )}
          </VStack>
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}

export function HttpTestResponseDisplay({
  result,
  explainError,
}: {
  result: HttpTestResult;
  explainError?: HttpTestErrorExplanationPort;
}) {
  const responseString =
    typeof result.response === "string"
      ? result.response
      : JSON.stringify(result.response, null, 2);

  return (
    <VStack align="stretch" gap={3}>
      {(result.status !== void 0 || result.duration !== void 0 || responseString) && (
        <HStack
          justify="space-between"
          padding={3}
          bg={result.success ? "green.50" : "red.50"}
          borderRadius="md"
          borderWidth="1px"
          borderColor={result.success ? "green.200" : "red.200"}
        >
          <HStack gap={3}>
            {result.status !== void 0 && (
              <Badge colorPalette={getStatusColor(result.status)} size="lg">
                {result.status} {result.statusText ?? ""}
              </Badge>
            )}
            {result.duration !== void 0 && (
              <HStack gap={1} color="fg.muted" fontSize="sm">
                <Clock size={14} />
                <Text>{formatDuration(result.duration)}</Text>
              </HStack>
            )}
          </HStack>
          {responseString && <CopyButton text={responseString} label="Copy response" />}
        </HStack>
      )}

      {!result.success && <TestFailure result={result} explainError={explainError} />}

      {result.warnings && result.warnings.length > 0 && (
        <Alert.Root status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Some variables had no value</Alert.Title>
            <Alert.Description>
              <VStack align="start" gap={1}>
                {result.warnings.map((warning) => (
                  <Text key={warning} fontSize="sm">
                    {warning}
                  </Text>
                ))}
              </VStack>
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}

      {result.renderedBody && (
        <CollapsibleSection title="Request Body Sent">
          <Box
            as="pre"
            fontSize="xs"
            fontFamily="mono"
            bg="bg.subtle"
            padding={2}
            borderRadius="md"
            overflow="auto"
          >
            {result.renderedBody}
          </Box>
        </CollapsibleSection>
      )}

      {result.responseHeaders && Object.keys(result.responseHeaders).length > 0 && (
        <CollapsibleSection title="Response Headers">
          <Box
            as="pre"
            fontSize="xs"
            fontFamily="mono"
            bg="bg.subtle"
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

      {result.response !== void 0 && (
        <CollapsibleSection title="Response Body" defaultOpen>
          <Box
            as="pre"
            fontSize="xs"
            fontFamily="mono"
            bg="bg.subtle"
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

      {result.extractedOutput !== void 0 && (
        <Box padding={3} bg="blue.50" borderRadius="md" borderWidth="1px" borderColor="blue.200">
          <HStack justify="space-between" marginBottom={2}>
            <Text fontSize="sm" fontWeight="medium" color="blue.700">
              Extracted Output (JSONPath)
            </Text>
            <CopyButton text={result.extractedOutput} label="Copy extracted output" />
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

      {result.success && result.response !== void 0 && result.extractedOutput === void 0 && (
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

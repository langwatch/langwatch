import type { HttpTestErrorExplanation, HttpTestResult } from "@langwatch/agent-contract/http-test";
import { UNKNOWN_ERROR_DESCRIPTION } from "@langwatch/browser-host/errors";
import { Card } from "@langwatch/design-system/card";
import { Alert, Badge, Box, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { explainAnyError } from "@langwatch/handled-error/presentation";
import { AlertCircle, Clock } from "lucide-react";

import { locateJsonPathNode } from "../../model/json-path-segments.ts";
import { responseShape } from "../../model/known-response-shapes.ts";
import { CollapsibleSection, CopyButton } from "../elements/http-test-components.tsx";

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

/** A failure the test call threw, kept as thrown so its copy resolves where the alert renders. */
export type ThrownTestFailure = {
  error: unknown;
  /** Headline when the registry has no copy for the error. */
  fallbackTitle: string;
};

function explanationOfThrown({ error, fallbackTitle }: ThrownTestFailure) {
  const explanation = explainAnyError(error);
  return {
    title: explanation.isRegistered ? explanation.title : fallbackTitle,
    description: explanation.description || UNKNOWN_ERROR_DESCRIPTION,
  };
}

function TestFailure({
  result,
  explainError,
  thrownFailure,
}: {
  result: HttpTestResult;
  explainError?: HttpTestErrorExplanation;
  thrownFailure?: ThrownTestFailure;
}) {
  const explanation = (thrownFailure
    ? explanationOfThrown(thrownFailure)
    : explainError?.({ errorCode: result.errorCode, status: result.status })) ?? {
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
        {explanation.description && (
          <Alert.Description>
            <Text fontSize="sm">{explanation.description}</Text>
          </Alert.Description>
        )}
      </Alert.Content>
    </Alert.Root>
  );
}

export function HttpTestResponseDisplay({
  result,
  explainError,
  thrownFailure,
  outputPath,
}: {
  result: HttpTestResult;
  explainError?: HttpTestErrorExplanation;
  /** Set when the call threw rather than returning a result; its copy wins over `explainError`. */
  thrownFailure?: ThrownTestFailure;
  /** The JSONPath whose node is marked in the response body. */
  outputPath?: string;
}) {
  const parsed = responseShape({ response: result.response });
  const located =
    outputPath && parsed !== undefined
      ? locateJsonPathNode({ value: parsed, path: outputPath })
      : undefined;
  const responseString =
    located?.text ??
    (typeof result.response === "string"
      ? result.response
      : JSON.stringify(result.response, null, 2));
  const range = located?.range;

  return (
    <VStack align="stretch" gap={3}>
      {(result.status !== void 0 || result.duration !== void 0 || responseString) && (
        <Card variant="nested" tone={result.success ? "green" : "red"} padding="sm">
          <HStack justify="space-between">
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
        </Card>
      )}

      {!result.success && (
        <TestFailure result={result} explainError={explainError} thrownFailure={thrownFailure} />
      )}

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
            {range ? (
              <>
                {responseString.slice(0, range.start)}
                <Box
                  as="mark"
                  bg="yellow.subtle"
                  color="fg"
                  borderRadius="sm"
                  data-testid="response-output-mark"
                >
                  {responseString.slice(range.start, range.end)}
                </Box>
                {responseString.slice(range.end)}
              </>
            ) : (
              responseString
            )}
          </Box>
        </CollapsibleSection>
      )}

      {result.extractedOutput !== void 0 && (
        <Card variant="nested" tone="blue" padding="sm">
          <HStack justify="space-between" marginBottom={2}>
            <Text fontSize="sm" fontWeight="medium" color="blue.fg">
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
        </Card>
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

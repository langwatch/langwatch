import {
  Alert,
  Box,
  Button,
  Field,
  HStack,
  Spinner,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { Play } from "lucide-react";
import { useState, useCallback } from "react";

const DEFAULT_TEST_BODY = `{
  "messages": [{"role": "user", "content": "Hello"}]
}`;

export type HttpTestPanelProps = {
  onTest: (requestBody: string) => Promise<{
    success: boolean;
    response?: unknown;
    extractedOutput?: string;
    error?: string;
  }>;
  disabled?: boolean;
};

/**
 * Test panel for HTTP agents.
 * Provides a raw JSON body editor for testing requests.
 */
export function HttpTestPanel({
  onTest,
  disabled = false,
}: HttpTestPanelProps) {
  const [requestBody, setRequestBody] = useState(DEFAULT_TEST_BODY);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    response?: unknown;
    extractedOutput?: string;
    error?: string;
  } | null>(null);

  const handleTest = useCallback(async () => {
    setIsLoading(true);
    setResult(null);
    try {
      const response = await onTest(requestBody);
      setResult(response);
    } catch (err) {
      setResult({
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsLoading(false);
    }
  }, [requestBody, onTest]);

  return (
    <VStack align="stretch" gap={4} width="full">
      {/* Request Body */}
      <Field.Root>
        <Field.Label>Request Body (JSON)</Field.Label>
        <Textarea
          value={requestBody}
          onChange={(e) => setRequestBody(e.target.value)}
          placeholder='{"messages": [{"role": "user", "content": "Hello, world!"}]}'
          fontFamily="mono"
          fontSize="sm"
          minHeight="150px"
          disabled={disabled}
          data-testid="test-request-body"
        />
      </Field.Root>

      {/* Test Button */}
      <HStack justify="flex-end">
        <Button
          colorPalette="blue"
          onClick={handleTest}
          disabled={disabled || isLoading}
          size="sm"
        >
          {isLoading ? <Spinner size="sm" /> : <Play size={16} />}
          Test Request
        </Button>
      </HStack>

      {/* Result Display */}
      {result && (
        <Box>
          {result.success ? (
            <Alert.Root status="success">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Request Successful</Alert.Title>
                <Alert.Description>
                  <VStack align="stretch" gap={2} marginTop={2}>
                    <Box
                      as="pre"
                      fontSize="xs"
                      fontFamily="mono"
                      overflow="auto"
                      maxHeight="200px"
                      whiteSpace="pre-wrap"
                      bg="gray.50"
                      padding={2}
                      borderRadius="md"
                    >
                      {JSON.stringify(result.response, null, 2)}
                    </Box>
                    {result.extractedOutput && (
                      <Box>
                        <Text fontSize="xs" fontWeight="medium" color="gray.600">
                          Extracted output:
                        </Text>
                        <Text fontSize="sm" fontFamily="mono">
                          {result.extractedOutput}
                        </Text>
                      </Box>
                    )}
                  </VStack>
                </Alert.Description>
              </Alert.Content>
            </Alert.Root>
          ) : (
            <Alert.Root status="error">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Request Failed</Alert.Title>
                <Alert.Description>{result.error}</Alert.Description>
              </Alert.Content>
            </Alert.Root>
          )}
        </Box>
      )}
    </VStack>
  );
}

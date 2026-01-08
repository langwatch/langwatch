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
import type { Field as DSLField } from "~/optimization_studio/types/dsl";
import { VariableTypeIcon, TYPE_LABELS } from "~/prompts/components/ui/VariableTypeIcon";

export type HttpTestPanelProps = {
  inputs: DSLField[];
  onTest: (inputValues: Record<string, string>) => Promise<{
    success: boolean;
    response?: unknown;
    error?: string;
  }>;
  disabled?: boolean;
};

/**
 * Test panel for HTTP agents.
 * Provides input fields for each defined input and a test button.
 */
export function HttpTestPanel({
  inputs,
  onTest,
  disabled = false,
}: HttpTestPanelProps) {
  const [inputValues, setInputValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const input of inputs) {
      initial[input.identifier] = getDefaultValue(input.type);
    }
    return initial;
  });
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    response?: unknown;
    error?: string;
  } | null>(null);

  const handleValueChange = useCallback(
    (identifier: string, value: string) => {
      setInputValues((prev) => ({ ...prev, [identifier]: value }));
    },
    []
  );

  const handleTest = useCallback(async () => {
    setIsLoading(true);
    setResult(null);
    try {
      const response = await onTest(inputValues);
      setResult(response);
    } catch (err) {
      setResult({
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsLoading(false);
    }
  }, [inputValues, onTest]);

  return (
    <VStack align="stretch" gap={4} width="full">
      {/* Header */}
      <HStack justify="space-between">
        <VStack align="start" gap={0}>
          <Text fontWeight="medium">Test Input Values</Text>
          <Text fontSize="sm" color="gray.500">
            Provide sample values for each input field
          </Text>
        </VStack>
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

      {/* Input Fields */}
      <VStack align="stretch" gap={3}>
        {inputs.map((input) => (
          <Field.Root key={input.identifier}>
            <Field.Label>
              <HStack gap={2}>
                <VariableTypeIcon type={input.type} size={14} />
                <Text fontFamily="mono" fontSize="sm">
                  {input.identifier}
                </Text>
                <Text fontSize="xs" color="gray.500">
                  {TYPE_LABELS[input.type] ?? input.type}
                </Text>
              </HStack>
            </Field.Label>
            <Textarea
              value={inputValues[input.identifier] ?? ""}
              onChange={(e) =>
                handleValueChange(input.identifier, e.target.value)
              }
              placeholder={getPlaceholder(input.type)}
              fontFamily="mono"
              fontSize="13px"
              minHeight="60px"
              resize="vertical"
              disabled={disabled}
            />
          </Field.Root>
        ))}
      </VStack>

      {/* Result Display */}
      {result && (
        <Box>
          {result.success ? (
            <Alert.Root status="success">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Request Successful</Alert.Title>
                <Alert.Description>
                  <Box
                    as="pre"
                    fontSize="xs"
                    fontFamily="mono"
                    overflow="auto"
                    maxHeight="200px"
                    whiteSpace="pre-wrap"
                    marginTop={2}
                  >
                    {JSON.stringify(result.response, null, 2)}
                  </Box>
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

function getDefaultValue(type: string): string {
  switch (type) {
    case "list":
    case "list[str]":
      return '["example"]';
    case "dict":
      return "{}";
    case "bool":
      return "true";
    case "float":
    case "int":
      return "0";
    case "chat_messages":
      return '[{"role": "user", "content": "Hello"}]';
    default:
      return "";
  }
}

function getPlaceholder(type: string): string {
  switch (type) {
    case "list":
    case "list[str]":
      return '["item1", "item2"]';
    case "dict":
      return '{"key": "value"}';
    case "bool":
      return "true or false";
    case "float":
    case "int":
      return "123";
    case "chat_messages":
      return '[{"role": "user", "content": "Hello"}]';
    default:
      return "Enter value...";
  }
}

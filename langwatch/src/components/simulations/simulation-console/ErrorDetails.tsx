import { Box, Text, VStack, Code } from "@chakra-ui/react";

import { CONSOLE_COLORS } from "./constants";

interface ParsedError {
  name?: string;
  message?: string;
  stack?: string;
}

/**
 * Parses error string and returns structured error object
 * Single Responsibility: Safely parses error JSON or handles plain strings
 */
function parseError(errorString?: string): ParsedError | null {
  if (!errorString) return null;

  // Check if it looks like JSON (starts with { and ends with })
  if (errorString.trim().startsWith("{") && errorString.trim().endsWith("}")) {
    try {
      return JSON.parse(errorString);
    } catch {
      // If JSON parsing fails, return the raw string as message
      return { message: errorString };
    }
  }

  // If it's not JSON, treat as plain string message
  return { message: errorString };
}

interface ErrorDetailsProps {
  error: string;
}

/**
 * Error details component
 * Single Responsibility: Displays structured error information in console format
 */
export function ErrorDetails({ error }: ErrorDetailsProps) {
  const parsedError = parseError(error);

  if (!parsedError) return null;

  return (
    <Box>
      <Text color={CONSOLE_COLORS.failureColor} fontWeight="semibold" mb={1}>
        Error Details:
      </Text>
      <VStack align="start" gap={1} pl={2}>
        {parsedError.name && (
          <Text color={CONSOLE_COLORS.failureColor} fontSize="sm">
            <Text as="span" color="white">
              Type:
            </Text>{" "}
            {parsedError.name}
          </Text>
        )}
        {parsedError.message && (
          <Text color={CONSOLE_COLORS.failureColor} fontSize="sm">
            <Text as="span" color="white">
              Message:
            </Text>{" "}
            {parsedError.message}
          </Text>
        )}
        {parsedError.stack && (
          <Box>
            <Text color="white" fontSize="sm" mb={1}>
              Stack Trace:
            </Text>
            <Code
              colorScheme="red"
              bg="transparent"
              color={CONSOLE_COLORS.failureColor}
              fontSize="xs"
              whiteSpace="pre-wrap"
              display="block"
              width="100%"
              pl={2}
            >
              {parsedError.stack}
            </Code>
          </Box>
        )}
      </VStack>
    </Box>
  );
}

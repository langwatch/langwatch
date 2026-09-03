import { Text, VStack } from "@chakra-ui/react";
import { isValidElement } from "react";

interface FormErrorDisplayProps {
  error?: unknown;
}

/**
 * Extracts error messages from various error structures
 */
export function extractErrorMessages(error: unknown): string[] {
  const messages: string[] = [];

  function processError(obj: unknown): void {
    if (!obj || typeof obj !== "object") return;

    // Handle single field error
    if (
      obj &&
      typeof obj === "object" &&
      "message" in obj &&
      typeof (obj as { message?: unknown }).message === "string"
    ) {
      messages.push((obj as { message: string }).message);
      return;
    }

    // Handle nested errors
    if (Array.isArray(obj)) {
      obj.forEach((item) => {
        processError(item);
      });
    } else {
      Object.values(obj as Record<string, unknown>).forEach((value) => {
        processError(value);
      });
    }
  }

  processError(error);
  return messages;
}

/** Renders a form error from any shape: element, string/number, or nested {message} object(s)/array. */
export function FormErrorDisplay({ error }: FormErrorDisplayProps) {
  // If it's a React element, render it directly
  if (isValidElement(error)) {
    return <>{error}</>;
  }

  // Handle null/undefined explicitly
  if (error === null || error === undefined) return null;

  // Handle primitive errors (strings and numbers)
  if (typeof error === "string" || typeof error === "number") {
    return (
      <Text marginTop="6px" fontSize="13px" color="fg.error">
        {error}
      </Text>
    );
  }

  // Handle structured error objects
  const messages = extractErrorMessages(error);

  if (messages.length === 0) return null;

  return (
    <VStack align="start" gap={1} marginTop="6px">
      {messages.map((message, index) => (
        <Text key={index} fontSize="13px" color="fg.error">
          {message}
        </Text>
      ))}
    </VStack>
  );
}

import { Text, VStack } from "@chakra-ui/react";
import { isValidElement } from "react";
import type { ReactNode } from "react";

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

/**
 * Robust form error display component that handles:
 * - Error objects: {message: "error"} or nested structures
 * - React elements: JSX elements to render directly
 * - Primitive errors: strings and numbers rendered as single error messages
 * - Arrays of errors: {field: [{message: "error1"}, {message: "error2"}]}
 */
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
      <Text fontSize="13px" color="red.500">
        {error}
      </Text>
    );
  }

  // Handle structured error objects
  const messages = extractErrorMessages(error);

  if (messages.length === 0) return null;

  return (
    <VStack align="start" gap={1}>
      {messages.map((message, index) => (
        <Text key={index} fontSize="13px" color="red.500">
          {message}
        </Text>
      ))}
    </VStack>
  );
}

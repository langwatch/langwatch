import { Alert, Link } from "@chakra-ui/react";
import type { ParsedLLMError } from "~/utils/formatLLMError";

interface ErrorMessageProps {
  error: ParsedLLMError;
}

/**
 * Displays error messages in the chat with type-specific styling and actions.
 */
export function ErrorMessage({ error }: ErrorMessageProps) {
  return (
    <Alert.Root status="error" borderRadius="md">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>
          {error.message}
          {renderAction(error.type)}
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}

function renderAction(type: ParsedLLMError["type"]) {
  switch (type) {
    case "not_found":
    case "auth":
      return (
        <>
          {" "}
          <Link
            href="/settings/model-providers"
            color="red.700"
            fontWeight="medium"
            textDecoration="underline"
          >
            Click here to check model provider settings
          </Link>
        </>
      );
    case "rate_limit":
      return " Please wait a moment and try again.";
    default:
      return null;
  }
}

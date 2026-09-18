import { Alert, Link } from "@chakra-ui/react";
import type { ParsedLLMError } from "@langwatch/prompt-contract";

interface ErrorMessageProps {
  error: ParsedLLMError;
}

// Type-specific rendering of provider errors: parseLLMError classifies to
// a closed set, enabling customer-actionable copy per type.
export function ErrorMessage({ error }: ErrorMessageProps) {
  const description = error.type === "unknown" ? UNKNOWN_FAILURE : describeLLMError(error.type);

  return (
    <Alert.Root status="error" borderRadius="md">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>
          {description}
          {renderAction(error.type)}
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}

/**
 * The generic line, verbatim from the client presentation registry's unknown
 * case: an error reaching this branch is one the classifier gave up on, which
 * is exactly what the registry answers the same sentence for.
 */
const UNKNOWN_FAILURE = "Something went wrong. We've been notified. Try again in a moment.";

/**
 * The sentence for each failure class `parseLLMError` recognises. Sits
 * next to `renderAction` (same discriminant, one switch each for what
 * happened and what to do). `unknown` is absent — the parser recognised nothing.
 */
function describeLLMError(type: Exclude<ParsedLLMError["type"], "unknown">) {
  switch (type) {
    case "auth":
      return "The model provider rejected our credentials for this model.";
    case "not_found":
      return "The model provider doesn't have the model this prompt asks for.";
    case "rate_limit":
      return "The model provider is rate-limiting this project, or the account behind it has no allowance left.";
    case "bad_request":
      return "The model provider rejected the request, usually a parameter this model doesn't support, or a conversation past its context limit.";
    case "connection":
      return "We couldn't reach the model provider.";
    default:
      // Unreachable while `type` really is one of the six, which the parse
      // boundary guarantees (`isLLMErrorType`). Kept because this value arrives
      // via JSON.parse: before that guard, a provider's own `api_error` reached
      // here and the switch returned `undefined`, rendering nothing where the
      // error text belonged. A stock line beats a blank.
      return "Something went wrong talking to the model provider.";
  }
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
            color="red.fg"
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

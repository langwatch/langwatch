import { Alert } from "@chakra-ui/react";
import type { ParsedLLMError } from "@langwatch/prompt-contract";

import { describeError } from "../../../../model/describe-error.ts";
import { Link } from "../../../../ui/elements/prompt-link.tsx";

interface ErrorMessageProps {
  error: ParsedLLMError;
}

/**
 * Displays chat error messages with type-specific styling and actions. Each
 * closed error type gets a written-here sentence that can't contain
 * anything upstream wrote, so no leaked provider text reaches the UI.
 */
export function ErrorMessage({ error }: ErrorMessageProps) {
  const description =
    error.type === "unknown" ? describeError({ error }) : describeLLMError(error.type);

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
 * The sentence for each failure class `parseLLMError` recognises. Sits next
 * to `renderAction` (same discriminant: one switch for what happened, one
 * for what to do). `unknown` is absent - it is the registry's generic case.
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
      return "The model provider rejected the request - usually a parameter this model doesn't support, or a conversation past its context limit.";
    case "connection":
      return "We couldn't reach the model provider.";
    default:
      // Unreachable while `type` really is one of the six, which the parse
      // boundary now guarantees (`isLLMErrorType`). Kept because this value
      // arrives via JSON.parse: before that guard, a provider's own `api_error`
      // reached here and the switch returned `undefined`, rendering nothing
      // where the error text belonged. A stock line beats a blank.
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

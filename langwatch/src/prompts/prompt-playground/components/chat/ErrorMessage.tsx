import { Alert } from "@chakra-ui/react";
import { Link } from "~/components/ui/link";
import { describeError } from "~/features/errors";
import type { ParsedLLMError } from "~/utils/formatLLMError";

interface ErrorMessageProps {
  error: ParsedLLMError;
}

/**
 * Displays error messages in the chat with type-specific styling and actions.
 *
 * This used to render `error.message`, which is NOT the message of an error we
 * threw: `parseLLMError` pulls it out of the model provider's own response
 * body. The justification was that the provider's sentence is the point ("Your
 * credit balance is too low" is a fix; "something went wrong" is not), with a
 * credential mask over the top to make it safe.
 *
 * The mask was the flaw. It matched credential SHAPES, so it could only ever
 * cover the shapes someone had thought of — and the body it was covering is the
 * one OpenAI fills with `Incorrect API key provided: sk-proj-…`, where on a
 * managed provider the key is LangWatch's rather than the customer's.
 *
 * What survived the removal is the part that was always doing the work:
 * `parseLLMError` already classifies the failure into a small closed set of
 * types, and this component already branched on that set to choose an action
 * link. So the type now chooses the sentence too. Each one is written below,
 * says what the customer can actually do, and cannot contain anything an
 * upstream wrote. `unknown` keeps going to the registry, as before.
 */
export function ErrorMessage({ error }: ErrorMessageProps) {
  const description =
    error.type === "unknown"
      ? describeError({ error })
      : describeLLMError(error.type);

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
 * The sentence for each failure class `parseLLMError` recognises.
 *
 * Sits next to `renderAction`, which has always chosen the follow-on link off
 * the same discriminant — one switch for what happened, one for what to do
 * about it. `unknown` is absent on purpose: it means the parser recognised
 * nothing, which is the registry's generic case, not a case to write copy for.
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
      return "The model provider rejected the request — usually a parameter this model doesn't support, or a conversation past its context limit.";
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

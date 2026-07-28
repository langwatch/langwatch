import { Alert } from "@chakra-ui/react";
import { Link } from "~/components/ui/link";
import { describeError } from "~/features/errors";
// Deep import: `safeRelayedProse` is the clamp the registry applies to a third
// party's sentence, and it is not on the barrel because nothing outside the
// errors module had needed it until this surface.
import { safeRelayedProse } from "~/features/errors/logic/readHandledError";
import type { ParsedLLMError } from "~/utils/formatLLMError";

interface ErrorMessageProps {
  error: ParsedLLMError;
}

/**
 * Displays error messages in the chat with type-specific styling and actions.
 *
 * `error.message` here is NOT the message of an error we threw. `parseLLMError`
 * pulls it out of the model provider's own response body, and showing that
 * sentence is the point of the playground: "Your credit balance is too low" is
 * the fix, where "something went wrong" is advice that cannot work.
 *
 * Two rules keep that from being a leak:
 *
 *  - `type: "unknown"` means the parser recognised nothing, so the string is
 *    whatever message the copilotkit adapter happened to catch — one of ours,
 *    a driver diagnostic, a stack-adjacent internal. Those are explained by
 *    the registry rather than recited.
 *  - Everything else is a third party's prose, so it is credential-masked and
 *    clamped to a sentence, exactly as the registry does for
 *    `llm_upstream_error`.
 */
export function ErrorMessage({ error }: ErrorMessageProps) {
  const description =
    error.type === "unknown"
      ? describeError({ error })
      : safeRelayedProse(error.message);

  return (
    <Alert.Root status="error" borderRadius="md">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>
          {/* The guard sees a local derived from `.message` and can't see that
              the derivation is `safeRelayedProse`, the registry's own clamp for
              a third party's sentence. Exempted per line, not per file. */}
          {description /* no-raw-error-toast-ok */}
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

// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * How single sign-on setup reports a failure, in one place. Every word comes
 * from the code-keyed registry and never `error.message`: since #5984 the
 * wire message for a handled error IS the code, so rendering it would show an
 * administrator `sso_activation_break_glass_missing`.
 */
import { Alert, Text } from "@chakra-ui/react";
import { resolveUiFailureCopy } from "@langwatch/browser-host/feedback";

/**
 * A refusal from a change, ON THE PAGE, beside the control that caused it.
 *
 * A toast is the wrong place for a setup journey's failure: the reader is
 * mid-task, and eight seconds later it is gone with the step still stuck and
 * nothing on screen admitting it. Rendered inline it stays until the next
 * attempt replaces it.
 */
export function InlineRefusal({ error, what }: { error: unknown; what?: string }) {
  if (error === null || error === void 0) return null;

  // `what` is ONLY the fallback. A registered code's title is the sentence
  // written for that exact failure, and naming the act instead throws it
  // away — the title and the description would then describe two different
  // failures, which is the defect this precedence exists to prevent.
  const copy = resolveUiFailureCopy({
    error,
    fallbackTitle: what === void 0 ? "" : `${what} didn't work`,
  });

  return (
    <Alert.Root status="error" data-testid="sso-inline-refusal">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{copy.title}</Alert.Title>
        <Alert.Description>{copy.description}</Alert.Description>
        {copy.traceId !== void 0 && (
          <Text color="fg.subtle" fontSize="xs">
            Reference {copy.traceId}
          </Text>
        )}
      </Alert.Content>
    </Alert.Root>
  );
}

/**
 * A read that failed, said out loud — never an empty list and never silence.
 *
 * "We could not find out" and "there is nothing here" are different facts,
 * and showing the second when the first is true is how somebody concludes
 * their way back in has vanished.
 */
export function LoadFailure({ error, what }: { error: unknown; what: string }) {
  const copy = resolveUiFailureCopy({ error, fallbackTitle: "" });

  return (
    <Alert.Root status="error" data-testid="sso-load-failure">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{copy.title}</Alert.Title>
        <Alert.Description>
          {copy.description} We could not load {what}.
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}

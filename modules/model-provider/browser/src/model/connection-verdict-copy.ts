/**
 * Renders a connection-test verdict from its stable `code`, read out of the shared registry
 * (as main's connection test did), so every refusal a provider can answer has its own sentence.
 * The provider's own sentence never renders, since a credential body can echo it back.
 */
import type { SerializedHandledError } from "@langwatch/handled-error";
import { explainSerializedError } from "@langwatch/handled-error/presentation";

/** The generic line for a failure we cannot name, and the floor under the rest. */
export const UNKNOWN_FAILURE_DESCRIPTION =
  "Something went wrong on our side. Try again in a moment.";

/** A refusal, as the row should read it: one sentence, no provider prose. */
export function describeRefusal(domainError: SerializedHandledError): string {
  const { title, description } = explainSerializedError(domainError);
  return `${title}. ${description || UNKNOWN_FAILURE_DESCRIPTION}`;
}

/**
 * The whole explanation as one string, for a slot that can only take text: the probe itself
 * failed to run, so there is no code to read, and it names the action and stops.
 */
export function describeFailure({ fallbackTitle }: { fallbackTitle: string }): string {
  return `${fallbackTitle}. ${UNKNOWN_FAILURE_DESCRIPTION}`;
}

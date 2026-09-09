/**
 * One line for a failure this screen renders INLINE rather than toasting.
 *
 * The chat's error bubble is the only place in this family that prints a
 * failure in the page body instead of handing it to the host's feedback
 * capability, and it does so for one branch: an `unknown` LLM error, where
 * `parseLLMError` could not classify the provider's answer. `platform/app`
 * resolved that through the application's code-keyed presentation registry,
 * which a feature-web package may not reach.
 *
 * DEGRADED TO THE GENERIC LINE, deliberately, and this is the stub
 * `@langwatch/gateway-web`, `@langwatch/ops-web` and `@langwatch/user-web` all
 * took. The model-config family carried a real code-keyed table instead,
 * because there the specific sentence WAS the feature — "that API key was
 * refused" and "nothing answered" send a customer to two different places.
 * Here the branch that reaches this function is the one the classifier already
 * gave up on, so the registry's answer for it was the generic line too.
 *
 * It becomes real when the presentation registry is harvested out of
 * `platform/app`; the obligation is recorded in
 * `dev/docs/plans/ui-family-move-manifests.md`.
 */

/**
 * The words are `UNKNOWN_ERROR_PRESENTATION`'s, verbatim
 * (`platform/app/src/features/errors/logic/presentation.ts`), because that is
 * exactly what the registry returns for an error carrying no handled payload —
 * which every failure reaching this branch does. Keeping them identical is what
 * lets the scenario that pins this sentence stay bound, and what makes the
 * harvest a deletion rather than a rewrite.
 */
export function describeError(_input: { error: unknown }): string {
  return "Something went wrong. We've been notified. Try again in a moment.";
}

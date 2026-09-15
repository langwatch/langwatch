/**
 * One line for a failure this screen renders INLINE rather than toasting: an
 * `unknown` LLM error `parseLLMError` couldn't classify. The real answer lives
 * in `platform/app`'s code-keyed presentation registry, unreachable from a
 * feature-web package, so this is deliberately the same generic stub every
 * other feature-web package took until the registry is harvested out of
 * `platform/app` (see `dev/docs/plans/ui-family-move-manifests.md`).
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

/**
 * One line for an `unknown` LLM error `parseLLMError` couldn't classify. The
 * real answer lives in `platform/app`'s registry, unreachable from a
 * feature-web package, so this is a stub until the registry is harvested out.
 */

/**
 * Verbatim copy of `UNKNOWN_ERROR_PRESENTATION`'s words
 * (`platform/app/.../presentation.ts`) - keeping them identical keeps the
 * pinning scenario bound, and makes the harvest a deletion, not a rewrite.
 */
export function describeError(_input: { error: unknown }): string {
  return "Something went wrong. We've been notified. Try again in a moment.";
}

import type { ModelRole } from "./featureRegistry";
import { ModelNotConfiguredError } from "./modelNotConfiguredError";

/**
 * Stable wire-format cause for downstream AI failures that aren't a
 * MODEL_NOT_CONFIGURED — e.g. the provider returned 401 on a stale
 * key, the registered custom model id no longer exists, the SDK
 * threw a parse error on a malformed response. The frontend
 * interceptor lifts this into a softer "double-check your model
 * configuration" toast (see `MissingModelToast`).
 *
 * Distinct from MODEL_NOT_CONFIGURED: that one says "you have nothing
 * set". This one says "you have something set, but it didn't work" —
 * with a hint that the provider configuration is the most common
 * culprit.
 */
export const AI_CALL_FAILED_CAUSE = "AI_CALL_FAILED" as const;

export class AiCallFailedError extends Error {
  public readonly cause = AI_CALL_FAILED_CAUSE;

  constructor(
    public readonly featureKey: string,
    public readonly role: ModelRole,
    public readonly featureDisplayName: string,
    public readonly originalErrorMessage: string,
  ) {
    super(
      `AI call failed for "${featureKey}" (role: ${role}): ${originalErrorMessage}`,
    );
    this.name = "AiCallFailedError";
  }

  toResponseBody(): {
    cause: typeof AI_CALL_FAILED_CAUSE;
    featureKey: string;
    role: ModelRole;
    featureDisplayName: string;
    errorMessage: string;
  } {
    return {
      cause: this.cause,
      featureKey: this.featureKey,
      role: this.role,
      featureDisplayName: this.featureDisplayName,
      errorMessage: this.originalErrorMessage,
    };
  }
}

/**
 * Wraps a function performing an AI call (generateText, embeddings,
 * stream, etc.) so a non-MODEL_NOT_CONFIGURED failure rethrows as a
 * typed `AiCallFailedError` carrying the feature context.
 * MODEL_NOT_CONFIGURED errors pass through untouched — they have
 * their own toast surface.
 */
export async function wrapAiCall<T>(
  feature: { key: string; role: ModelRole; displayName: string },
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ModelNotConfiguredError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    // Truncate provider messages so noisy stack-laden errors don't
    // spill into the toast description verbatim. The first line of
    // a provider error is usually the actionable one.
    const firstLine = message.split("\n")[0]!.slice(0, 200);
    throw new AiCallFailedError(
      feature.key,
      feature.role,
      feature.displayName,
      firstLine,
    );
  }
}

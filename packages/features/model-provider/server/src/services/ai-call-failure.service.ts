import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";

import {
  ModelNotConfiguredError,
  ModelProviderDisabledError,
  type ModelRole,
} from "@langwatch/model-provider-contract";

const logger = createLogger("langwatch:modelProviders:aiCall");

/**
 * Legacy wire-format discriminator carried on the tRPC `data.cause` sidecar.
 * @deprecated NOT the error's code — the code is `ai_call_failed`, which is
 */
export const AI_CALL_FAILED_CAUSE = "AI_CALL_FAILED" as const;

/**
 * Thrown when a downstream AI call fails for a reason that is NOT "no model is configured"
 * — the provider returned 401 on a stale key, the registered custom model id no longer
 * exists, the SDK threw parsing a malformed response.
 */
export class AiCallFailedError extends HandledError {
  declare readonly code: "ai_call_failed";

  /**
   * @deprecated The legacy alias of `code` — see {@link AI_CALL_FAILED_CAUSE}.
   */
  public readonly cause = AI_CALL_FAILED_CAUSE;

  constructor(
    public readonly featureKey: string,
    public readonly role: ModelRole,
    public readonly featureDisplayName: string,
    /**
     * The provider's / SDK's own sentence.
     */
    public readonly originalErrorMessage: string,
  ) {
    super("ai_call_failed", `AI call failed for "${featureKey}".`, {
      httpStatus: 400,
      fault: "provider",
      // Read by the missing-model/AI-failure toast surface. Carried on the
      // handled payload (not only on the legacy `data.cause` sidecar) so the
      // bespoke `aiCallFailedCause` block in `trpc.ts` can be deleted without
      // the toast losing the feature it is talking about.
      meta: { featureKey, role, featureDisplayName },
    });
    this.name = "AiCallFailedError";
  }

  toResponseBody(): {
    cause: typeof AI_CALL_FAILED_CAUSE;
    featureKey: string;
    role: ModelRole;
    featureDisplayName: string;
  } {
    return {
      cause: this.cause,
      featureKey: this.featureKey,
      role: this.role,
      featureDisplayName: this.featureDisplayName,
    };
  }
}

export class AiCallFailureService {
  static create(): AiCallFailureService {
    return new AiCallFailureService();
  }

  private constructor() {}

  /**
   * Wraps a function performing an AI call (generateText, embeddings, stream, etc.) so a failure the caller cannot name rethrows as a typed `AiCallFailedError`
   * carrying the feature context. `ModelNotConfiguredError` and `ModelProviderDisabledError` pass through untouched — both are raised by model resolution, which now
   * happens inside the wrapped call, and each has its own remediation copy the generic ai_call_failed message would bury.
   */
  async wrapAiCall<T>(
    feature: { key: string; role: ModelRole; displayName: string },
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ModelNotConfiguredError) {
        throw err;
      }

      if (err instanceof ModelProviderDisabledError) {
        throw err;
      }

      const message = err instanceof Error ? err.message : String(err);
      // The provider's own words are diagnostic, not copy: they go in the log
      // line, correlated by trace id, and nowhere a customer can read them.
      logger.error({ featureKey: feature.key, role: feature.role, err }, "AI call failed");
      // Truncate: `originalErrorMessage` still travels on the legacy tRPC
      // `data.cause` sidecar until that block is retired, and a stack-laden
      // provider error should not be dragged along wholesale.
      const firstLine = message.split("\n")[0]!.slice(0, 200);

      throw new AiCallFailedError(feature.key, feature.role, feature.displayName, firstLine);
    }
  }
}

import { HandledError } from "@langwatch/handled-error";
import { AiCallFailedError, type ModelRole } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import { APICallError, RetryError } from "ai";

const logger = createLogger("langwatch:modelProviders:aiCall");

/** Refusals that carry their own remediation copy, so they pass through unwrapped. */
const PASS_THROUGH_CODES: ReadonlySet<string> = new Set([
  "model_execution_unavailable",
  "model_not_configured",
  "model_provider_disabled",
  "model_provider_unavailable",
]);

/**
 * Whether another attempt could succeed. A provider's own refusal (a 4xx such as a bad key or
 * an unsupported parameter) answers the same every time; anything else may be a blip.
 */
function isRetryableAiFailure(error: unknown): boolean {
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  if (APICallError.isInstance(cause)) return cause.isRetryable;

  return true;
}

export class AiCallFailureService {
  static create(): AiCallFailureService {
    return new AiCallFailureService();
  }

  private constructor() {}

  /**
   * Rethrows an unnamed AI-call failure as a typed `AiCallFailedError` carrying the feature
   * context and the wrapped cause. Configuration refusals pass through with their own copy.
   */
  async wrapAiCall<T>(
    feature: { key: string; role: ModelRole; displayName: string },
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (HandledError.isHandled(err) && PASS_THROUGH_CODES.has(err.code)) {
        throw err;
      }

      const message = err instanceof Error ? err.message : String(err);
      const retryable = isRetryableAiFailure(err);
      // The provider's own words are diagnostic, not copy: they go in the log
      // line, correlated by trace id, and nowhere a customer can read them.
      logger.error(
        { featureKey: feature.key, role: feature.role, retryable, err },
        "AI call failed",
      );
      // Truncate: `originalErrorMessage` still travels on the legacy tRPC
      // `data.cause` sidecar until that block is retired.
      const firstLine = message.split("\n")[0]!.slice(0, 200);

      throw new AiCallFailedError({
        featureKey: feature.key,
        role: feature.role,
        featureDisplayName: feature.displayName,
        originalErrorMessage: firstLine,
        retryable,
        // Only a handled cause carries a code worth keeping; a raw one is already logged above.
        ...(HandledError.isHandled(err) ? { reasons: [err] } : {}),
      });
    }
  }
}

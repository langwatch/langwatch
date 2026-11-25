import { HandledError } from "@langwatch/handled-error";
import {
  AiCallFailedError,
  AiContentFilteredError,
  type ModelRole,
} from "@langwatch/model-provider-contract";
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

/** Whether the provider's content filter refused the input: Azure answers 400 `content_filter`. */
function readContentFilterRefusal(
  error: unknown,
): { filtered: true; providerResponse: string } | { filtered: false } {
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  if (!APICallError.isInstance(cause) || cause.statusCode !== 400) return { filtered: false };
  const body = cause.responseBody ?? "";

  return /"code"\s*:\s*"content_filter"/.test(body)
    ? { filtered: true, providerResponse: body }
    : { filtered: false };
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
      const refusal = readContentFilterRefusal(err);
      if (refusal.filtered) {
        // The body says which filter fired; the request body would repeat the refused text.
        logger.warn(
          {
            featureKey: feature.key,
            role: feature.role,
            providerResponse: refusal.providerResponse,
          },
          "AI call filtered",
        );
        throw new AiContentFilteredError({
          featureKey: feature.key,
          role: feature.role,
          featureDisplayName: feature.displayName,
        });
      }
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

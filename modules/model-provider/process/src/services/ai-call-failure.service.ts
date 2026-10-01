import {
  AiCallFailedError,
  ModelNotConfiguredError,
  ModelProviderDisabledError,
  type ModelRole,
} from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:modelProviders:aiCall");

export class AiCallFailureService {
  static create(): AiCallFailureService {
    return new AiCallFailureService();
  }

  private constructor() {}

  /**
   * Rethrows an unnamed AI-call failure as a typed `AiCallFailedError` carrying the feature
   * context. `ModelNotConfiguredError` and `ModelProviderDisabledError` pass through with
   * their own remediation copy, which the generic ai_call_failed message would bury.
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

      throw new AiCallFailedError({
        featureKey: feature.key,
        role: feature.role,
        featureDisplayName: feature.displayName,
        originalErrorMessage: firstLine,
      });
    }
  }
}

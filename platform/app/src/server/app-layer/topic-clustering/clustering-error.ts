/**
 * Classifies a clustering failure into something the customer can act on
 * versus an internal fault (ADR-051). User-actionable failures surface with
 * guidance on the settings page (and feed the planned home-notice/email
 * follow-up); internal ones read as "we're on it".
 *
 * HOW THIS DECIDES, and why it is not pattern matching.
 *
 * The code that FAILS knows why it failed. It knows whether it was resolving
 * the project's model configuration or posting to langevals; that is a fact,
 * available for free at the throw site. Reconstructing it afterwards by
 * regexing the message string is strictly worse information: the earlier cut
 * of this file matched `/\b403\b/` and `/billing/i` anywhere in the text, so
 * ClickHouse reading cold parts off S3, or any internal error whose body
 * happened to quote an upstream `401`, was reported to the customer as *their*
 * credentials being wrong. It sent people to rotate keys that were fine while
 * the actual outage was ours, and it only held together as long as nobody
 * reworded an error.
 *
 * So failures we understand are thrown as {@link ClusteringError} with an
 * explicit code, and anything else is INTERNAL — not the customer's problem
 * until we can say otherwise. That is the safe direction to be wrong in.
 */

import { ModelNotConfiguredError } from "../../modelProviders/modelNotConfiguredError";

export const CLUSTERING_ERROR_CODES = {
  /**
   * No usable model configuration for the clustering LLM or embeddings
   * feature — the dominant production failure. Detected by us, while
   * resolving the project's own configuration, so it is attributable with
   * certainty.
   */
  MODEL_NOT_CONFIGURED: "model_not_configured",
  /**
   * The model provider rejected the customer's credentials.
   *
   * NOTHING SETS THIS TODAY, deliberately. We never call the provider — we
   * hand litellm params to langevals and it makes the call — so a provider
   * auth failure reaches us only as the body of a langevals 5xx. Guessing at
   * that body is what this file used to do, and it was wrong often enough to
   * be worse than silence. The code stays defined because rows already carry
   * it and the settings page still renders fixed copy for it; setting it again
   * needs langevals to return a STRUCTURED provider error, not prose.
   */
  MODEL_PROVIDER_AUTH: "model_provider_auth",
  /** The model provider refused for quota/billing reasons. Same caveat as
   *  {@link CLUSTERING_ERROR_CODES.MODEL_PROVIDER_AUTH}: nothing sets it yet. */
  MODEL_PROVIDER_QUOTA: "model_provider_quota",
  /**
   * The clustering service (langevals) itself failed. Ours to fix, and the
   * default for a langevals failure precisely because its response body is not
   * reliable evidence about whose fault it was.
   */
  CLUSTERING_SERVICE: "clustering_service",
  /** Anything we cannot attribute. Never user-actionable. */
  INTERNAL: "internal",
} as const;
export type ClusteringErrorCode =
  (typeof CLUSTERING_ERROR_CODES)[keyof typeof CLUSTERING_ERROR_CODES];

export interface ClassifiedClusteringError {
  code: ClusteringErrorCode;
  isUserActionable: boolean;
}

/**
 * The codes a customer can actually do something about. Kept as one list so
 * "is this the customer's to fix?" has a single answer rather than a boolean
 * repeated at every throw site, where it would eventually disagree with itself.
 */
const USER_ACTIONABLE_CODES = new Set<ClusteringErrorCode>([
  CLUSTERING_ERROR_CODES.MODEL_NOT_CONFIGURED,
  CLUSTERING_ERROR_CODES.MODEL_PROVIDER_AUTH,
  CLUSTERING_ERROR_CODES.MODEL_PROVIDER_QUOTA,
]);

/**
 * A clustering failure that knows what it is. Throw this wherever the cause is
 * established; everything else is treated as an internal fault.
 *
 * `message` is for operators — logs and the projection — and may contain raw
 * upstream detail. It is never sent to the product surface: the client is given
 * the code only, and picks fixed copy from it.
 */
export class ClusteringError extends Error {
  readonly code: ClusteringErrorCode;

  constructor(
    code: ClusteringErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ClusteringError";
    this.code = code;
  }

  get isUserActionable(): boolean {
    return USER_ACTIONABLE_CODES.has(this.code);
  }
}

export function classifyClusteringError(
  error: unknown,
): ClassifiedClusteringError {
  if (error instanceof ClusteringError) {
    return { code: error.code, isUserActionable: error.isUserActionable };
  }
  // Raised by the model-resolution cascade itself, which already knows exactly
  // which feature and role had nothing set. It is thrown from shared code we
  // do not own, so it is matched here by type rather than re-wrapped at every
  // call site — still a type, still not a string.
  if (error instanceof ModelNotConfiguredError) {
    return {
      code: CLUSTERING_ERROR_CODES.MODEL_NOT_CONFIGURED,
      isUserActionable: true,
    };
  }
  // Unattributed: a bug, a dependency we did not wrap, an infrastructure
  // failure. Fail closed — we do not tell someone their configuration is
  // broken on the strength of not recognising an error.
  return { code: CLUSTERING_ERROR_CODES.INTERNAL, isUserActionable: false };
}

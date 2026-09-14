/**
 * Classifies clustering failures: user-actionable (ADR-051) vs internal faults.
 * Explicit codes at throw site, never string matching.
 */

export const CLUSTERING_ERROR_CODES = {
  /**
   * No usable model configuration for the clustering LLM or embeddings
   * feature — the dominant production failure. Detected by us, while
   * resolving the project's own configuration, so it is attributable with
   * certainty.
   */
  MODEL_NOT_CONFIGURED: "model_not_configured",
  /**
   * Model provider auth rejection. Defined for backwards compatibility but
   * not set until langevals returns structured provider errors.
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

  constructor(code: ClusteringErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ClusteringError";
    this.code = code;
  }

  get isUserActionable(): boolean {
    return USER_ACTIONABLE_CODES.has(this.code);
  }
}

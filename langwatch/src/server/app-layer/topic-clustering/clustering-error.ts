/**
 * Classifies a clustering failure into something the customer can act on
 * versus an internal fault (ADR-051). User-actionable failures surface with
 * guidance on the settings page (and feed the planned home-notice/email
 * follow-up); internal ones read as "we're on it".
 */

export const CLUSTERING_ERROR_CODES = {
  /**
   * No default model configured for the clustering LLM or embeddings
   * feature — the dominant production failure (thrown as `No model
   * configured for "analytics.topic_clustering_llm" (role: FAST, …)` /
   * the `analytics.topic_clustering_embeddings` EMBEDDINGS variant).
   */
  MODEL_NOT_CONFIGURED: "model_not_configured",
  /** The model provider rejected our credentials — customer-owned keys. */
  MODEL_PROVIDER_AUTH: "model_provider_auth",
  /** The model provider refused for quota/billing/rate reasons. */
  MODEL_PROVIDER_QUOTA: "model_provider_quota",
  /**
   * The clustering service (langevals) itself failed — e.g. `Failed to
   * fetch topics batch clustering (langevals): Internal Server Error`.
   * Ours to fix; never shown raw to the customer.
   */
  CLUSTERING_SERVICE: "clustering_service",
  /** Anything we can't confidently pin on customer configuration. */
  INTERNAL: "internal",
} as const;
export type ClusteringErrorCode =
  (typeof CLUSTERING_ERROR_CODES)[keyof typeof CLUSTERING_ERROR_CODES];

export interface ClassifiedClusteringError {
  code: ClusteringErrorCode;
  userActionable: boolean;
}

const AUTH_PATTERNS = [
  /\b401\b/,
  /\b403\b/,
  /unauthorized/i,
  /forbidden/i,
  /invalid[\s_-]*api[\s_-]*key/i,
  /incorrect[\s_-]*api[\s_-]*key/i,
  /authentication/i,
];

const QUOTA_PATTERNS = [
  /\b429\b/,
  /quota/i,
  /rate[\s_-]*limit/i,
  /insufficient[\s_-]*(credits|funds|balance)/i,
  /billing/i,
];

export function classifyClusteringError(
  error: unknown,
): ClassifiedClusteringError {
  const message = error instanceof Error ? error.message : String(error);
  if (/no model configured/i.test(message)) {
    return {
      code: CLUSTERING_ERROR_CODES.MODEL_NOT_CONFIGURED,
      userActionable: true,
    };
  }
  if (AUTH_PATTERNS.some((p) => p.test(message))) {
    return { code: CLUSTERING_ERROR_CODES.MODEL_PROVIDER_AUTH, userActionable: true };
  }
  if (QUOTA_PATTERNS.some((p) => p.test(message))) {
    return { code: CLUSTERING_ERROR_CODES.MODEL_PROVIDER_QUOTA, userActionable: true };
  }
  if (/langevals/i.test(message)) {
    return {
      code: CLUSTERING_ERROR_CODES.CLUSTERING_SERVICE,
      userActionable: false,
    };
  }
  return { code: CLUSTERING_ERROR_CODES.INTERNAL, userActionable: false };
}

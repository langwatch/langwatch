import { describe, expect, it } from "vitest";

import { ModelNotConfiguredError } from "../../../modelProviders/modelNotConfiguredError";
import {
  CLUSTERING_ERROR_CODES,
  ClusteringError,
  classifyClusteringError,
} from "../clustering-error";

/**
 * Classification is decided at the throw site, so these tests are about the
 * CONTRACT — a failure carries its own code, and anything unattributed is ours.
 *
 * The previous implementation regexed the message text, and the tests only
 * covered messages it was designed to match, so the interesting cases could
 * not fail: an internal error whose body happened to quote an upstream `401`
 * was reported to the customer as their credentials being wrong. The negative
 * cases below are the ones that matter now.
 */
describe("classifyClusteringError", () => {
  describe("given a failure that knows what it is", () => {
    it("reports the code it was thrown with", () => {
      const error = new ClusteringError(
        CLUSTERING_ERROR_CODES.CLUSTERING_SERVICE,
        "Failed to fetch topics batch clustering (langevals): Internal Server Error",
      );

      expect(classifyClusteringError(error)).toEqual({
        code: "clustering_service",
        userActionable: false,
      });
    });

    it("treats a missing model configuration as the customer's to fix", () => {
      const error = new ClusteringError(
        CLUSTERING_ERROR_CODES.MODEL_NOT_CONFIGURED,
        "Topic clustering model provider openai not found",
      );

      expect(classifyClusteringError(error)).toEqual({
        code: "model_not_configured",
        userActionable: true,
      });
    });
  });

  describe("given the model-resolution cascade found nothing configured", () => {
    it.each([
      ["analytics.topic_clustering_llm", "FAST" as const],
      ["analytics.topic_clustering_embeddings", "EMBEDDINGS" as const],
    ])("classifies %s as user-actionable", (featureKey, role) => {
      const error = new ModelNotConfiguredError(
        featureKey,
        role,
        "Topic clustering",
        "project_mDIreHYSk8qhfNVnbpPyb",
      );

      expect(classifyClusteringError(error)).toEqual({
        code: "model_not_configured",
        userActionable: true,
      });
    });
  });

  /**
   * The regression suite. Every message below would have matched the old
   * auth/quota patterns and been shown to the customer as their problem.
   */
  describe("given an unattributed failure that merely reads like a credentials problem", () => {
    it.each([
      // ClickHouse reading cold parts back out of object storage.
      "Code: 499. DB::Exception: Failed to get object: 403 Forbidden (S3Error)",
      // A langevals 5xx that quoted the upstream provider's response.
      'Failed to fetch topics batch clustering (langevals): Internal Server Error\n\n{"detail": "openai.AuthenticationError: Error code: 401"}',
      // Anything at all mentioning the words that used to trigger a verdict.
      "Unexpected token in billing reconciliation job",
      "429 Too Many Requests",
      "Unauthorized",
    ])("attributes it to us, not the customer: %s", (message) => {
      expect(classifyClusteringError(new Error(message))).toEqual({
        code: "internal",
        userActionable: false,
      });
    });

    it("does not guess from a non-Error value either", () => {
      expect(classifyClusteringError("401 unauthorized")).toEqual({
        code: "internal",
        userActionable: false,
      });
    });
  });
});

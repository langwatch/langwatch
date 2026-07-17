import { describe, expect, it } from "vitest";

import { classifyClusteringError } from "../clustering-error";

/**
 * The example messages below are real production failures pulled from Loki
 * (2026-07-17) — the classifier must keep recognizing these exact shapes.
 */
describe("classifyClusteringError", () => {
  describe("when no default model is configured", () => {
    it.each([
      'No model configured for "analytics.topic_clustering_llm" (role: FAST, project: project_mDIreHYSk8qhfNVnbpPyb).',
      'No model configured for "analytics.topic_clustering_embeddings" (role: EMBEDDINGS, project: project_ERHVqGQvPVnZIrfertRDv).',
    ])("classifies as user-actionable model_not_configured: %s", (message) => {
      expect(classifyClusteringError(new Error(message))).toEqual({
        code: "model_not_configured",
        userActionable: true,
      });
    });
  });

  describe("when the clustering service itself fails", () => {
    it.each([
      'Failed to fetch topics batch clustering (langevals): Internal Server Error\n\n{\n  "detail": "Batch clustering failed"\n}',
      'Failed to fetch topics incremental clustering (langevals): Internal Server Error\n\n{\n  "detail": "Incremental clustering failed"\n}',
    ])("classifies as internal clustering_service: %s", (message) => {
      expect(classifyClusteringError(new Error(message))).toEqual({
        code: "clustering_service",
        userActionable: false,
      });
    });
  });

  describe("when the model provider rejects credentials", () => {
    it.each([
      "401 Unauthorized",
      "Incorrect API key provided: sk-****",
      "AuthenticationError: invalid api key",
    ])("classifies as user-actionable auth failure: %s", (message) => {
      expect(classifyClusteringError(new Error(message))).toEqual({
        code: "model_provider_auth",
        userActionable: true,
      });
    });
  });

  describe("when the model provider refuses on quota", () => {
    it.each([
      "429 Too Many Requests: rate limit exceeded",
      "You exceeded your current quota, please check your plan and billing details",
    ])("classifies as user-actionable quota failure: %s", (message) => {
      expect(classifyClusteringError(new Error(message))).toEqual({
        code: "model_provider_quota",
        userActionable: true,
      });
    });
  });

  describe("when the failure is unrecognized", () => {
    it("defaults to internal and not user-actionable", () => {
      expect(
        classifyClusteringError(new Error("ECONNRESET reading ClickHouse")),
      ).toEqual({ code: "internal", userActionable: false });
    });
  });
});

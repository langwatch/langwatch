import { describe, expect, it } from "vitest";
import { resolveLangevalsRuntimeConfig } from "../langevals.config";

describe("resolveLangevalsRuntimeConfig", () => {
  it("projects payload staging policy into typed process configuration", () => {
    expect(
      resolveLangevalsRuntimeConfig({
        LANGEVALS_ENDPOINT: "http://langevals.internal:8000",
        LANGEVALS_STAGING_THRESHOLD_BYTES: "1024",
        LANGEVALS_STAGING_TTL_SECONDS: "90",
        EVAL_MAX_PAYLOAD_BYTES: "2048",
        TOPIC_CLUSTERING_MAX_PAYLOAD_BYTES: "4096",
      }),
    ).toEqual({
      endpoint: "http://langevals.internal:8000",
      maxRetries: 1,
      timeoutMs: 120_000,
      payload: {
        stagingThresholdBytes: 1_024,
        stagingTtlSeconds: 90,
        evaluationMaxPayloadBytes: 2_048,
        topicClusteringMaxPayloadBytes: 4_096,
      },
    });
  });
});

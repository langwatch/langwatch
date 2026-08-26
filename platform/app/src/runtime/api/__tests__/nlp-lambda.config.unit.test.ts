import { describe, expect, it } from "vitest";
import { createStudioNlpCacheKey } from "../nlp-lambda.cache-key";
import { resolveNlpLambdaRuntimeConfig } from "../nlp-lambda.config";

describe("resolveNlpLambdaRuntimeConfig", () => {
  it("parses the Lambda deployment once at the boot boundary", () => {
    const config = resolveNlpLambdaRuntimeConfig({
      BASE_HOST: "https://app.example.com",
      LANGWATCH_NLP_LAMBDA_CONFIG: JSON.stringify({
        AWS_ACCESS_KEY_ID: "key",
        AWS_SECRET_ACCESS_KEY: "secret",
        AWS_REGION: "eu-central-1",
        role_arn: "arn:aws:iam::123:role/nlp",
        image_uri: "registry.example/nlp:1",
        cache_bucket: "nlp-cache",
        subnet_ids: ["subnet-a"],
        security_group_ids: ["sg-a"],
      }),
      LANGWATCH_NLP_SERVICE: "http://nlp.internal",
      LANGEVALS_STAGING_THRESHOLD_BYTES: 1_024,
      LANGEVALS_STAGING_TTL_SECONDS: 90,
      EVAL_MAX_PAYLOAD_BYTES: 2_048,
      S3_KEY_SALT: "studio-cache-salt",
    });

    expect(config).toEqual({
      baseHost: "https://app.example.com",
      deployment: {
        AWS_ACCESS_KEY_ID: "key",
        AWS_SECRET_ACCESS_KEY: "secret",
        AWS_REGION: "eu-central-1",
        role_arn: "arn:aws:iam::123:role/nlp",
        image_uri: "registry.example/nlp:1",
        cache_bucket: "nlp-cache",
        subnet_ids: ["subnet-a"],
        security_group_ids: ["sg-a"],
      },
      serviceUrl: "http://nlp.internal",
      staging: { thresholdBytes: 1_024, ttlSeconds: 90 },
      maxPayloadBytes: 2_048,
      studioCacheKeySalt: "studio-cache-salt",
    });
  });

  it("rejects malformed Lambda deployment JSON before composition", () => {
    expect(() =>
      resolveNlpLambdaRuntimeConfig({ LANGWATCH_NLP_LAMBDA_CONFIG: "not-json" }),
    ).toThrow("Failed to parse LANGWATCH_NLP_LAMBDA_CONFIG");
  });
});

describe("createStudioNlpCacheKey", () => {
  it("preserves the monthly project-and-salt cache namespace", () => {
    expect(
      createStudioNlpCacheKey({
        projectId: "project_a",
        salt: "salt",
        now: new Date("2026-08-26T00:00:00.000Z"),
      }),
    ).toBe("v35spy7mqcsv6sv5");
  });

  it.each([undefined, ""])("does not send a cache key without a usable salt", (salt) => {
    expect(
      createStudioNlpCacheKey({
        projectId: "project_a",
        salt,
        now: new Date("2026-08-26T00:00:00.000Z"),
      }),
    ).toBeUndefined();
  });
});

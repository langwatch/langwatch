/**
 * The studio's Lambda deployment as one environment value, and the code-block
 * ceiling every per-project function is created with.
 *
 * @see packages/features/workflow/specs/studio-lambda-stream.feature
 */
import { describe, expect, it } from "vitest";
import {
  NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_DEFAULT_SECONDS,
  buildStudioLambdaEnvironment,
  clampCodeBlockTimeoutSeconds,
  resolveStudioLambdaConfig,
} from "../nlp-lambda-config.rules.ts";

const COMPLETE = JSON.stringify({
  AWS_REGION: "eu-central-1",
  AWS_ACCESS_KEY_ID: "key",
  AWS_SECRET_ACCESS_KEY: "secret",
  role_arn: "arn:aws:iam::123:role/nlp",
  image_uri: "123.dkr.ecr.eu-central-1.amazonaws.com/nlp:v9",
  cache_bucket: "langwatch-nlp-cache",
  subnet_ids: ["subnet-1"],
  security_group_ids: ["sg-1"],
});

describe("given a deployment that fronts the studio engine with a Lambda fleet", () => {
  describe("when the fleet is fully described", () => {
    /** @scenario "A complete Lambda fleet configuration composes the Lambda path" */
    it("reads the account, the image and the network from one value", () => {
      const config = resolveStudioLambdaConfig({
        LANGWATCH_NLP_LAMBDA_CONFIG: COMPLETE,
        BASE_HOST: "https://app.langwatch.test",
      });

      expect(config).toMatchObject({
        region: "eu-central-1",
        roleArn: "arn:aws:iam::123:role/nlp",
        imageUri: "123.dkr.ecr.eu-central-1.amazonaws.com/nlp:v9",
        cacheBucket: "langwatch-nlp-cache",
        subnetIds: ["subnet-1"],
        securityGroupIds: ["sg-1"],
        langwatchEndpoint: "https://app.langwatch.test",
      });
    });

    /** @scenario "Every per-project function carries the same environment" */
    it("gives creation and reconciliation one environment to agree on", () => {
      const config = resolveStudioLambdaConfig({
        LANGWATCH_NLP_LAMBDA_CONFIG: COMPLETE,
        BASE_HOST: "https://app.langwatch.test",
      });

      expect(buildStudioLambdaEnvironment(config!)).toEqual({
        LANGWATCH_ENDPOINT: "https://app.langwatch.test",
        STUDIO_RUNTIME: "async",
        AWS_LWA_INVOKE_MODE: "RESPONSE_STREAM",
        CACHE_BUCKET: "langwatch-nlp-cache",
        NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS: "600",
      });
    });
  });

  describe("when the fleet is named badly or not at all", () => {
    /** @scenario "An absent or unusable fleet configuration leaves the HTTP path" */
    it("reads as an absence rather than a boot failure", () => {
      expect(resolveStudioLambdaConfig({})).toBeUndefined();
      expect(resolveStudioLambdaConfig({ LANGWATCH_NLP_LAMBDA_CONFIG: "{" })).toBeUndefined();
      expect(
        resolveStudioLambdaConfig({
          LANGWATCH_NLP_LAMBDA_CONFIG: JSON.stringify({ AWS_REGION: "eu-central-1" }),
        }),
      ).toBeUndefined();
    });
  });

  describe("when an operator sets the code-block ceiling", () => {
    /** @scenario "The code-block ceiling stays under both enclosing deadlines" */
    it("clamps the ceiling under the stream idle and invocation deadlines", () => {
      expect(clampCodeBlockTimeoutSeconds("300")).toBe(300);
      expect(clampCodeBlockTimeoutSeconds("100000")).toBe(710);
      expect(clampCodeBlockTimeoutSeconds("0.5")).toBe(
        NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_DEFAULT_SECONDS,
      );
      expect(clampCodeBlockTimeoutSeconds(undefined)).toBe(
        NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_DEFAULT_SECONDS,
      );
    });
  });
});

/**
 * The studio's Lambda deployment, assembled from its already-parsed fields,
 * and the code-block ceiling every per-project function is created with.
 *
 * @see packages/features/workflow/specs/studio-lambda-stream.feature
 */
import { describe, expect, it } from "vitest";
import {
  NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_DEFAULT_SECONDS,
  buildStudioLambdaConfig,
  buildStudioLambdaEnvironment,
  clampCodeBlockTimeoutSeconds,
  type StudioLambdaFleetFields,
} from "../nlp-lambda-config.rules.ts";

const FIELDS: StudioLambdaFleetFields = {
  region: "eu-central-1",
  accessKeyId: "key",
  secretAccessKey: "secret",
  roleArn: "arn:aws:iam::123:role/nlp",
  imageUri: "123.dkr.ecr.eu-central-1.amazonaws.com/nlp:v9",
  cacheBucket: "langwatch-nlp-cache",
  subnetIds: ["subnet-1"],
  securityGroupIds: ["sg-1"],
};

describe("given a deployment that fronts the studio engine with a Lambda fleet", () => {
  describe("when the fleet is fully described", () => {
    /** @scenario "A complete Lambda fleet configuration composes the Lambda path" */
    it("assembles the account, the image and the network from the parsed fields", () => {
      const config = buildStudioLambdaConfig({
        fields: FIELDS,
        langwatchEndpoint: "https://app.langwatch.test",
        codeBlockTimeoutRawValue: undefined,
        stagingThresholdBytesRawValue: undefined,
        stagingTtlSecondsRawValue: undefined,
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
      const config = buildStudioLambdaConfig({
        fields: FIELDS,
        langwatchEndpoint: "https://app.langwatch.test",
        codeBlockTimeoutRawValue: undefined,
        stagingThresholdBytesRawValue: undefined,
        stagingTtlSecondsRawValue: undefined,
      });

      expect(buildStudioLambdaEnvironment(config)).toEqual({
        LANGWATCH_ENDPOINT: "https://app.langwatch.test",
        STUDIO_RUNTIME: "async",
        AWS_LWA_INVOKE_MODE: "RESPONSE_STREAM",
        CACHE_BUCKET: "langwatch-nlp-cache",
        NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS: "600",
      });
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

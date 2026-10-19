import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { nlpLambdaFleetFromSecret, workflowConfig } from "../workflow.config.ts";

const fleet = {
  AWS_REGION: "eu-west-1",
  AWS_ACCESS_KEY_ID: "key",
  AWS_SECRET_ACCESS_KEY: "secret",
  role_arn: "arn:aws:iam::1:role/langwatch",
  image_uri: "1.dkr.ecr.eu-west-1.amazonaws.com/langwatch:latest",
  cache_bucket: "langwatch-cache",
  subnet_ids: ["subnet-1"],
  security_group_ids: ["sg-1"],
};

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({ owners: [{ name: "workflow", config: workflowConfig }], environment })
    .workflow;

describe("workflow server configuration", () => {
  describe("given a deployment fronts the engine with a staging threshold", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("carries it as written", () => {
      expect(read({ LANGEVALS_STAGING_THRESHOLD_BYTES: "1024" }).stagingThresholdBytes).toBe(1024);
    });
  });
});

describe("the NLP Lambda fleet secret, once the composition root resolves it", () => {
  describe("given no fleet is described", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("resolves no fleet", () => {
      expect(nlpLambdaFleetFromSecret.parse(undefined)).toBeUndefined();
    });
  });

  describe("given a deployment describes a complete fleet", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("resolves the described fleet", () => {
      expect(nlpLambdaFleetFromSecret.parse(JSON.stringify(fleet))).toEqual(fleet);
    });
  });

  describe("given a deployment names a fleet it did not describe", () => {
    /** @scenario "A named but unusable configuration refuses the boot" */
    it("refuses the boot rather than running the studio somewhere else", () => {
      expect(() => nlpLambdaFleetFromSecret.parse("{")).toThrow(/not valid JSON/);
      expect(() =>
        nlpLambdaFleetFromSecret.parse(JSON.stringify({ AWS_REGION: "eu-west-1" })),
      ).toThrow(/missing required fields/);
    });
  });
});

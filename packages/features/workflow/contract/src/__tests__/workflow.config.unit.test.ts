import { InvalidRuntimeConfigError, RuntimeConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";
import { workflowServerConfigDefinition } from "../workflow.config.ts";

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

const read = (source: Record<string, unknown>) =>
  RuntimeConfig.create({ name: "workflow", definition: workflowServerConfigDefinition, source })
    .value;

describe("workflow server configuration", () => {
  describe("given a deployment fronts the engine with no Lambda fleet", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("resolves no fleet", () => {
      expect(read({}).nlpLambdaFleet).toBeUndefined();
    });
  });

  describe("given a deployment describes a complete fleet", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("resolves the described fleet", () => {
      expect(read({ LANGWATCH_NLP_LAMBDA_CONFIG: JSON.stringify(fleet) }).nlpLambdaFleet).toEqual(
        fleet,
      );
    });
  });

  describe("given a deployment names a fleet it did not describe", () => {
    /** @scenario "A named but unusable configuration refuses the boot" */
    it("refuses the boot rather than running the studio somewhere else", () => {
      expect(() => read({ LANGWATCH_NLP_LAMBDA_CONFIG: "{" })).toThrow(InvalidRuntimeConfigError);
      expect(() =>
        read({ LANGWATCH_NLP_LAMBDA_CONFIG: JSON.stringify({ AWS_REGION: "eu-west-1" }) }),
      ).toThrow(InvalidRuntimeConfigError);
    });
  });
});

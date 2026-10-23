import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { nlpLambdaFleetFromSecret, workflowConfig } from "../workflow.config.ts";

const fleetPlacement = {
  AWS_REGION: "eu-west-1",
  role_arn: "arn:aws:iam::1:role/langwatch",
  image_uri: "1.dkr.ecr.eu-west-1.amazonaws.com/langwatch:latest",
  cache_bucket: "langwatch-cache",
  subnet_ids: ["subnet-1"],
  security_group_ids: ["sg-1"],
};
const staticKeys = { AWS_ACCESS_KEY_ID: "key", AWS_SECRET_ACCESS_KEY: "secret" };
const credentialsRole = { credentials_role_arn: "arn:aws:iam::1:role/langwatch-app" };

const parseFleet = (document: object) => nlpLambdaFleetFromSecret.parse(JSON.stringify(document));

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

  describe("given a deployment describes a complete fleet with a static key pair", () => {
    /** @scenario "A fleet naming only a static key pair signs with those keys" */
    it("resolves the described fleet, signed with those keys", () => {
      expect(parseFleet({ ...fleetPlacement, ...staticKeys })).toEqual({
        ...fleetPlacement,
        credentials: { kind: "static", accessKeyId: "key", secretAccessKey: "secret" },
      });
    });
  });

  describe("given a fleet names a credentials role and no key pair", () => {
    /** @scenario "A fleet naming a credentials role signs through the web identity" */
    it("resolves the fleet signed through that role", () => {
      expect(parseFleet({ ...fleetPlacement, ...credentialsRole })).toEqual({
        ...fleetPlacement,
        credentials: { kind: "web-identity", roleArn: "arn:aws:iam::1:role/langwatch-app" },
      });
    });
  });

  describe("given a fleet names a blank credentials role", () => {
    it("refuses the boot rather than sign through no role", () => {
      expect(() => parseFleet({ ...fleetPlacement, credentials_role_arn: " " })).toThrow(
        /missing required fields/,
      );
    });
  });

  describe("given a fleet names both a credentials role and a key pair", () => {
    /** @scenario "A fleet naming a credentials role signs through the web identity" */
    it("signs through the role and drops the keys", () => {
      const resolved = parseFleet({ ...fleetPlacement, ...staticKeys, ...credentialsRole });

      expect(resolved?.credentials).toEqual({
        kind: "web-identity",
        roleArn: "arn:aws:iam::1:role/langwatch-app",
      });
      expect(JSON.stringify(resolved)).not.toContain("secret");
    });
  });

  describe("given a fleet names neither a credentials role nor a complete key pair", () => {
    /** @scenario "A fleet naming no credentials refuses the boot" */
    it("refuses the boot, naming both ways to sign", () => {
      for (const document of [fleetPlacement, { ...fleetPlacement, AWS_ACCESS_KEY_ID: "key" }]) {
        expect(() => parseFleet(document)).toThrow(
          /names no credentials.*credentials_role_arn.*AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY/,
        );
      }
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

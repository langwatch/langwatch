import { describe, expect, it } from "vitest";

import { parseManagedBedrockDirectory } from "../managed-provider.config.ts";

const DEPLOYMENT = {
  proxyRoleArn: "proxy",
  bedrockRoleArn: "customer",
  proxyAwsAccessKeyId: "key",
  proxyAwsSecretAccessKey: "secret",
  bedrockProxyEndpoint: "private.internal",
  region: "eu-west-1",
};

describe("parseManagedBedrockDirectory", () => {
  describe("given a directory naming two organizations", () => {
    describe("when the process reads its configuration", () => {
      /** @scenario "Serve several organizations from one configured directory" */
      it("resolves each organization to its own deployment", () => {
        const parsed = parseManagedBedrockDirectory(
          JSON.stringify({
            org_1: DEPLOYMENT,
            org_2: { ...DEPLOYMENT, bedrockRoleArn: "other", region: "us-east-1" },
          }),
        );

        expect(parsed.org_1?.bedrockRoleArn).toBe("customer");
        expect(parsed.org_1?.region).toBe("eu-west-1");
        expect(parsed.org_2?.bedrockRoleArn).toBe("other");
        expect(parsed.org_2?.region).toBe("us-east-1");
      });
    });
  });

  describe("given no directory is configured", () => {
    describe("when the process reads its configuration", () => {
      /** @scenario "Run without managed Bedrock when none is configured" */
      it("resolves no organization and does not refuse", () => {
        expect(parseManagedBedrockDirectory(undefined)).toEqual({});
        expect(parseManagedBedrockDirectory("  ")).toEqual({});
      });
    });
  });

  describe("given a directory that is not valid JSON", () => {
    describe("when the process reads its configuration", () => {
      /** @scenario "Refuse a malformed directory when the process starts" */
      it("refuses and says the configuration is invalid", () => {
        expect(() => parseManagedBedrockDirectory("{not json")).toThrow(/not valid JSON/);
      });
    });
  });

  describe("given a deployment missing a required field", () => {
    describe("when the process reads its configuration", () => {
      /** @scenario "Refuse a directory whose deployment is incomplete" */
      it("refuses and says the configuration is invalid", () => {
        const { proxyAwsSecretAccessKey: _omitted, ...incomplete } = DEPLOYMENT;

        expect(() => parseManagedBedrockDirectory(JSON.stringify({ org_1: incomplete }))).toThrow(
          /complete Bedrock deployment/,
        );
      });
    });
  });
});

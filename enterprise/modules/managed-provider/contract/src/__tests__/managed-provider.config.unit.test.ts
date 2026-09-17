import { describe, expect, it } from "vitest";
import { managedProviderServerConfigSchema } from "../managed-provider.config.ts";

const DEPLOYMENT = {
  proxyRoleArn: "proxy",
  bedrockRoleArn: "customer",
  proxyAwsAccessKeyId: "key",
  proxyAwsSecretAccessKey: "secret",
  bedrockProxyEndpoint: "private.internal",
  region: "eu-west-1",
};

describe("managedProviderServerConfigSchema", () => {
  describe("given a directory naming two organizations", () => {
    describe("when the process reads its configuration", () => {
      /** @scenario "Serve several organizations from one configured directory" */
      it("resolves each organization to its own deployment", () => {
        const parsed = managedProviderServerConfigSchema.parse({
          bedrock: JSON.stringify({
            org_1: DEPLOYMENT,
            org_2: { ...DEPLOYMENT, bedrockRoleArn: "other", region: "us-east-1" },
          }),
        });

        expect(parsed.bedrock.org_1?.bedrockRoleArn).toBe("customer");
        expect(parsed.bedrock.org_1?.region).toBe("eu-west-1");
        expect(parsed.bedrock.org_2?.bedrockRoleArn).toBe("other");
        expect(parsed.bedrock.org_2?.region).toBe("us-east-1");
      });
    });
  });

  describe("given no directory is configured", () => {
    describe("when the process reads its configuration", () => {
      /** @scenario "Run without managed Bedrock when none is configured" */
      it("resolves no organization and does not refuse", () => {
        expect(managedProviderServerConfigSchema.parse({}).bedrock).toEqual({});
        expect(managedProviderServerConfigSchema.parse({ bedrock: "  " }).bedrock).toEqual({});
      });
    });
  });

  describe("given a directory that is not valid JSON", () => {
    describe("when the process reads its configuration", () => {
      /** @scenario "Refuse a malformed directory when the process starts" */
      it("refuses and says the configuration is invalid", () => {
        const result = managedProviderServerConfigSchema.safeParse({ bedrock: "{not json" });

        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.message).toContain("not valid JSON");
      });
    });
  });

  describe("given a deployment missing a required field", () => {
    describe("when the process reads its configuration", () => {
      /** @scenario "Refuse a directory whose deployment is incomplete" */
      it("refuses and says the configuration is invalid", () => {
        const { proxyAwsSecretAccessKey: _omitted, ...incomplete } = DEPLOYMENT;
        const result = managedProviderServerConfigSchema.safeParse({
          bedrock: JSON.stringify({ org_1: incomplete }),
        });

        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.message).toContain("complete Bedrock deployment");
      });
    });
  });
});

import { describe, expect, it } from "vitest";
import { managedBedrockConfigSchema } from "../src";

describe("managedBedrockConfigSchema", () => {
  it("defaults the AWS region", () => {
    const parsed = managedBedrockConfigSchema.parse({
      proxyRoleArn: "proxy",
      bedrockRoleArn: "bedrock",
      proxyAwsAccessKeyId: "key",
      proxyAwsSecretAccessKey: "secret",
      bedrockProxyEndpoint: "private.example",
    });
    expect(parsed.region).toBe("us-east-1");
  });
});

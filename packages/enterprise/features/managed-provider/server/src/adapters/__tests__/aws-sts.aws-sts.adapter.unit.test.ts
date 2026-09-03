import type { ManagedBedrockConfig } from "@langwatch/enterprise-managed-provider-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AwsStsManagedProviderCredentialAdapter } from "../aws-sts.aws-sts.adapter";

const sts = vi.hoisted(() => ({
  clients: [] as Array<{
    region: string;
    credentials: { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
  }>,
  assumed: [] as Array<{ clientIndex: number; roleArn: string }>,
  proxyReturnsCredentials: true,
}));

vi.mock("@aws-sdk/client-sts", () => {
  class AssumeRoleCommand {
    constructor(readonly input: { RoleArn: string; RoleSessionName: string }) {}
  }

  class STSClient {
    private readonly index: number;

    constructor(config: {
      region: string;
      credentials: { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
    }) {
      this.index = sts.clients.length;
      sts.clients.push(config);
    }

    async send(command: AssumeRoleCommand): Promise<{
      Credentials?: { AccessKeyId?: string; SecretAccessKey?: string; SessionToken?: string };
    }> {
      sts.assumed.push({ clientIndex: this.index, roleArn: command.input.RoleArn });

      if (this.index === 0) {
        if (!sts.proxyReturnsCredentials) {
          return {};
        }

        return {
          Credentials: {
            AccessKeyId: "proxy-key",
            SecretAccessKey: "proxy-secret",
            SessionToken: "proxy-token",
          },
        };
      }

      return {
        Credentials: {
          AccessKeyId: "customer-key",
          SecretAccessKey: "customer-secret",
          SessionToken: "customer-token",
        },
      };
    }
  }

  return { AssumeRoleCommand, STSClient };
});

const CONFIG: ManagedBedrockConfig = {
  proxyRoleArn: "arn:aws:iam::1:role/proxy",
  bedrockRoleArn: "arn:aws:iam::2:role/customer",
  proxyAwsAccessKeyId: "static-key",
  proxyAwsSecretAccessKey: "static-secret",
  bedrockProxyEndpoint: "private.internal",
  region: "eu-west-1",
};

describe("AwsStsManagedProviderCredentialAdapter", () => {
  beforeEach(() => {
    sts.clients.length = 0;
    sts.assumed.length = 0;
    sts.proxyReturnsCredentials = true;
  });

  describe("given a managed Bedrock configuration naming both roles", () => {
    describe("when the customer role is assumed", () => {
      /** @scenario "Build credentials through both roles" */
      it("assumes the proxy role first and reaches the customer role with what it returned", async () => {
        const adapter = AwsStsManagedProviderCredentialAdapter.create();

        const credentials = await adapter.assumeCustomerRole(CONFIG);

        expect(sts.assumed.map((call) => call.roleArn)).toEqual([
          CONFIG.proxyRoleArn,
          CONFIG.bedrockRoleArn,
        ]);
        expect(sts.assumed.map((call) => call.clientIndex)).toEqual([0, 1]);
        expect(sts.clients[0]?.credentials).toEqual({
          accessKeyId: "static-key",
          secretAccessKey: "static-secret",
        });
        expect(sts.clients[1]?.credentials).toEqual({
          accessKeyId: "proxy-key",
          secretAccessKey: "proxy-secret",
          sessionToken: "proxy-token",
        });
        expect(credentials).toEqual({
          accessKeyId: "customer-key",
          secretAccessKey: "customer-secret",
          sessionToken: "customer-token",
        });
      });
    });

    describe("when the proxy role hands back no credentials", () => {
      /** @scenario "Build credentials through both roles" */
      it("fails before reaching the customer role", async () => {
        sts.proxyReturnsCredentials = false;
        const adapter = AwsStsManagedProviderCredentialAdapter.create();

        await expect(adapter.assumeCustomerRole(CONFIG)).rejects.toThrow(
          "Failed to get proxy role credentials",
        );
        expect(sts.assumed.map((call) => call.roleArn)).toEqual([CONFIG.proxyRoleArn]);
      });
    });
  });
});

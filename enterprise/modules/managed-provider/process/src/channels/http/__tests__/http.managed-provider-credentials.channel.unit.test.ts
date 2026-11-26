import type { ManagedBedrockConfig } from "@langwatch/enterprise-managed-provider-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HttpManagedProviderCredentialsChannel } from "../http.managed-provider-credentials.channel.ts";

const sts = vi.hoisted(() => ({
  clients: [] as {
    region: string;
    endpoint?: string;
    credentials: { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
  }[],
  assumed: [] as { clientIndex: number; roleArn: string; abortSignal?: AbortSignal }[],
  proxyReturnsCredentials: true,
  proxyStalls: false,
}));

vi.mock("@aws-sdk/client-sts", () => {
  class AssumeRoleCommand {
    constructor(readonly input: { RoleArn: string; RoleSessionName: string }) {}
  }

  class STSClient {
    private readonly index: number;

    constructor(config: {
      region: string;
      endpoint?: string;
      credentials: { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
    }) {
      this.index = sts.clients.length;
      sts.clients.push(config);
    }

    async send(
      command: AssumeRoleCommand,
      options?: { abortSignal?: AbortSignal },
    ): Promise<{
      Credentials?: { AccessKeyId?: string; SecretAccessKey?: string; SessionToken?: string };
    }> {
      sts.assumed.push({
        clientIndex: this.index,
        roleArn: command.input.RoleArn,
        abortSignal: options?.abortSignal,
      });

      if (this.index === 0) {
        if (sts.proxyStalls) {
          return new Promise((_resolve, reject) => {
            options?.abortSignal?.addEventListener("abort", () =>
              reject(options.abortSignal?.reason),
            );
          });
        }
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

describe("HttpManagedProviderCredentialsChannel", () => {
  beforeEach(() => {
    sts.clients.length = 0;
    sts.assumed.length = 0;
    sts.proxyReturnsCredentials = true;
    sts.proxyStalls = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given a managed Bedrock configuration naming both roles", () => {
    describe("when the customer role is assumed", () => {
      /** @scenario "Build credentials through both roles" */
      it("assumes the proxy role first and reaches the customer role with what it returned", async () => {
        const adapter = HttpManagedProviderCredentialsChannel.create();

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

    describe("when the proxy role hop never answers", () => {
      /** @scenario "A stalled role hop gives up inside the gateway's config fetch" */
      it("gives up at 1.5s, inside the gateway's 2s config fetch, without reaching the customer role", async () => {
        vi.useFakeTimers();
        sts.proxyStalls = true;
        const outcome = HttpManagedProviderCredentialsChannel.create()
          .assumeCustomerRole(CONFIG)
          .then(
            () => "resolved",
            (error: Error) => error.message,
          );

        await vi.advanceTimersByTimeAsync(1499);
        const early = await Promise.race([outcome, Promise.resolve("still waiting")]);
        await vi.advanceTimersByTimeAsync(1);

        expect(early).toBe("still waiting");
        await expect(outcome).resolves.toBe("The managed Bedrock role hops ran out of time");
        expect(sts.assumed.map((call) => call.roleArn)).toEqual([CONFIG.proxyRoleArn]);
      });

      it("bounds both hops with one deadline", async () => {
        await HttpManagedProviderCredentialsChannel.create().assumeCustomerRole(CONFIG);

        const [proxyHop, customerHop] = sts.assumed;
        expect(proxyHop?.abortSignal).toBeInstanceOf(AbortSignal);
        expect(customerHop?.abortSignal).toBe(proxyHop?.abortSignal);
      });
    });

    describe("when the deployment configures an STS base", () => {
      /** @scenario "The role hops reach the STS base the deployment configures" */
      it("sends both role hops to that base", async () => {
        const adapter = HttpManagedProviderCredentialsChannel.create({
          stsBase: "http://127.0.0.1:5597/sts",
        });

        await adapter.assumeCustomerRole(CONFIG);

        expect(sts.clients.map((client) => client.endpoint)).toEqual([
          "http://127.0.0.1:5597/sts",
          "http://127.0.0.1:5597/sts",
        ]);
      });
    });

    describe("when no STS base is configured", () => {
      /** @scenario "An STS base that is unset or blank reaches AWS" */
      it("leaves the endpoint to the AWS SDK", async () => {
        await HttpManagedProviderCredentialsChannel.create().assumeCustomerRole(CONFIG);

        expect(sts.clients.map((client) => client.endpoint)).toEqual([undefined, undefined]);
      });
    });

    describe("when the proxy role hands back no credentials", () => {
      /** @scenario "Build credentials through both roles" */
      it("fails before reaching the customer role", async () => {
        sts.proxyReturnsCredentials = false;
        const adapter = HttpManagedProviderCredentialsChannel.create();

        await expect(adapter.assumeCustomerRole(CONFIG)).rejects.toThrow(
          "Failed to get proxy role credentials",
        );
        expect(sts.assumed.map((call) => call.roleArn)).toEqual([CONFIG.proxyRoleArn]);
      });
    });
  });
});

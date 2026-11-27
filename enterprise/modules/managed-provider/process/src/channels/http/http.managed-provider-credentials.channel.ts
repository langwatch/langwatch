import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";
import type { ManagedBedrockConfig } from "@langwatch/enterprise-managed-provider-contract";

import {
  type ManagedProviderCredentials,
  ManagedProviderCredentialVendor,
} from "../managed-provider-credentials.channel.ts";

/** The role hops outlived their shared budget; the caller falls back to the row's stored keys. */
export class ManagedRoleHopTimeoutError extends Error {
  readonly code = "managed_role_hop_timeout";

  constructor() {
    super("The managed Bedrock role hops ran out of time");
    this.name = "ManagedRoleHopTimeoutError";
  }
}

/** One budget for both hops, inside the gateway's 2s background refresh: a stall fails one row. */
const ROLE_HOP_BUDGET_MS = 1500;

/**
 * The two-hop STS assumption a managed Bedrock call runs under: this
 * deployment's proxy role first, then the customer's own role from the
 * proxy's borrowed identity.
 */
export class HttpManagedProviderCredentialsChannel extends ManagedProviderCredentialVendor {
  private constructor(private readonly stsBase: string | undefined) {
    super();
  }

  /** `stsBase` replaces the region's STS endpoint for both hops (a dev stand-in); unset is AWS. */
  static create({ stsBase }: { stsBase?: string } = {}): HttpManagedProviderCredentialsChannel {
    return new HttpManagedProviderCredentialsChannel(stsBase);
  }

  async assumeCustomerRole(config: ManagedBedrockConfig): Promise<ManagedProviderCredentials> {
    const deadline = new AbortController();
    const timer = setTimeout(
      () => deadline.abort(new ManagedRoleHopTimeoutError()),
      ROLE_HOP_BUDGET_MS,
    );
    const timedOut = new Promise<never>((_resolve, reject) => {
      deadline.signal.addEventListener("abort", () => reject(deadline.signal.reason), {
        once: true,
      });
    });
    try {
      // The SDK's retry backoff ignores the signal, so the race enforces the budget.
      return await Promise.race([this.hop({ config, abortSignal: deadline.signal }), timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async hop({
    config,
    abortSignal,
  }: {
    config: ManagedBedrockConfig;
    abortSignal: AbortSignal;
  }): Promise<ManagedProviderCredentials> {
    const endpoint = this.stsBase === undefined ? {} : { endpoint: this.stsBase };
    const proxyClient = new STSClient({
      region: config.region,
      ...endpoint,
      credentials: {
        accessKeyId: config.proxyAwsAccessKeyId,
        secretAccessKey: config.proxyAwsSecretAccessKey,
      },
    });
    const proxy = await proxyClient.send(
      new AssumeRoleCommand({
        RoleArn: config.proxyRoleArn,
        RoleSessionName: "bedrock-test-python",
      }),
      { abortSignal },
    );
    const proxyCredentials = proxy.Credentials;
    if (
      !proxyCredentials?.AccessKeyId ||
      !proxyCredentials.SecretAccessKey ||
      !proxyCredentials.SessionToken
    ) {
      throw new Error("Failed to get proxy role credentials");
    }

    const customerClient = new STSClient({
      region: config.region,
      ...endpoint,
      credentials: {
        accessKeyId: proxyCredentials.AccessKeyId,
        secretAccessKey: proxyCredentials.SecretAccessKey,
        sessionToken: proxyCredentials.SessionToken,
      },
    });
    const customer = await customerClient.send(
      new AssumeRoleCommand({
        RoleArn: config.bedrockRoleArn,
        RoleSessionName: "bedrock-test-python",
      }),
      { abortSignal },
    );
    const credentials = customer.Credentials;
    if (!credentials?.AccessKeyId || !credentials.SecretAccessKey || !credentials.SessionToken) {
      throw new Error("Failed to get customer credentials");
    }
    return {
      accessKeyId: credentials.AccessKeyId,
      secretAccessKey: credentials.SecretAccessKey,
      sessionToken: credentials.SessionToken,
    };
  }
}

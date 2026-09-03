import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";
import type { ManagedBedrockConfig } from "@langwatch/enterprise-managed-provider-contract";
import {
  type ManagedProviderCredentials,
  ManagedProviderCredentialsPort,
} from "../ports/managed-provider-credentials.port";

export class AwsStsManagedProviderCredentialAdapter extends ManagedProviderCredentialsPort {
  private constructor() {
    super();
  }

  static create(): AwsStsManagedProviderCredentialAdapter {
    return new AwsStsManagedProviderCredentialAdapter();
  }

  async assumeCustomerRole(config: ManagedBedrockConfig): Promise<ManagedProviderCredentials> {
    const proxyClient = new STSClient({
      region: config.region,
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

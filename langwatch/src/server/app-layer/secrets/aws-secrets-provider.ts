import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import type { SecretsProvider } from "./secrets";

const FETCH_TIMEOUT_MS = 5_000;

export class AwsSecretsProvider implements SecretsProvider {
  private readonly client: SecretsManagerClient;

  constructor({ region }: { region?: string } = {}) {
    this.client = new SecretsManagerClient({
      region: region ?? process.env.AWS_REGION ?? "eu-central-1",
    });
  }

  async get(secretId: string): Promise<string> {
    try {
      const response = await this.client.send(
        new GetSecretValueCommand({ SecretId: secretId }),
        { abortSignal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
      );
      if (!response.SecretString) {
        throw new Error(`Secret "${secretId}" has no string value`);
      }
      return response.SecretString;
    } catch (err: unknown) {
      if (!(err instanceof Error)) throw err;
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        throw new Error(
          `[secrets] Timed out fetching "${secretId}" after ${FETCH_TIMEOUT_MS}ms. ` +
            `Your AWS SSO session may have expired — try: aws sso login`
        );
      }
      if (err.name === "CredentialsProviderError") {
        throw new Error(
          `[secrets] AWS credentials not found. ` +
            `Run "aws sso login" or configure your AWS profile. ` +
            `To skip, unset SECRETS_PROVIDER or set SECRETS_PROVIDER=env.`
        );
      }
      throw err;
    }
  }
}

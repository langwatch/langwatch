import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:secrets");

export interface SecretsProvider {
  get(secretId: string): Promise<string>;
}

export class MockSecretsProvider implements SecretsProvider {
  private readonly secrets: Map<string, string>;

  constructor(secrets: Record<string, string>) {
    this.secrets = new Map(Object.entries(secrets));
  }

  async get(secretId: string): Promise<string> {
    const value = this.secrets.get(secretId);
    if (value === undefined) {
      throw new Error(`secret_not_found: ${secretId}`);
    }
    return value;
  }
}

const ALLOWED_ENVIRONMENTS = new Set(["dev", "local"]);

export function createSecretsProvider(): SecretsProvider | null {
  const providerType = process.env.SECRETS_PROVIDER;
  if (!providerType || providerType === "env") return null;

  if (providerType === "aws") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AwsSecretsProvider } = require("./aws-secrets-provider") as {
      AwsSecretsProvider: new (opts?: {
        region?: string;
      }) => SecretsProvider;
    };
    return new AwsSecretsProvider({ region: process.env.AWS_REGION });
  }

  throw new Error(
    `Unknown SECRETS_PROVIDER: "${providerType}". Supported: "env", "aws"`
  );
}

export async function loadAppSecrets({
  provider,
  environment,
}: {
  provider: SecretsProvider | null;
  environment: string;
}): Promise<Record<string, string>> {
  if (!provider) return {};

  if (!ALLOWED_ENVIRONMENTS.has(environment)) {
    throw new Error(
      `[secrets] REFUSED: environment "${environment}" is not allowed. ` +
        `Only ${[...ALLOWED_ENVIRONMENTS].join(", ")} are permitted. ` +
        `Unset SECRETS_PROVIDER or set SECRETS_PROVIDER=env.`
    );
  }
  if (process.env.KUBERNETES_SERVICE_HOST) {
    throw new Error(
      `[secrets] REFUSED: cannot use AWS secrets provider inside a Kubernetes pod.`
    );
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `[secrets] REFUSED: cannot use AWS secrets provider with NODE_ENV=production.`
    );
  }

  const secretPath = `langwatch/${environment}/app`;
  logger.info({ secretPath }, "Fetching secrets from AWS SM");

  const raw = await provider.get(secretPath);
  const parsed: unknown = JSON.parse(raw);

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `[secrets] Expected JSON object from "${secretPath}", got ${typeof parsed}`
    );
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string") {
      throw new Error(
        `[secrets] Key "${key}" in "${secretPath}" is not a string`
      );
    }
  }

  const secrets = parsed as Record<string, string>;
  const count = Object.keys(secrets).length;
  logger.info({ secretPath, count }, "Loaded secrets from AWS SM");

  return secrets;
}

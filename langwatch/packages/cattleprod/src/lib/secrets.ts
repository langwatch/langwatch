import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

const AWS_REGION = "eu-central-1";

interface SecretsConfig {
  profile?: string;
  region?: string;
}

/**
 * Creates an AWS Secrets Manager client with the specified profile.
 */
function createSecretsClient(config: SecretsConfig): SecretsManagerClient {
  const { profile, region = AWS_REGION } = config;

  if (profile) {
    process.env.AWS_PROFILE = profile;
  }

  return new SecretsManagerClient({ region });
}

/**
 * Fetches a secret value from AWS Secrets Manager.
 */
export async function getSecret(
  secretName: string,
  config: SecretsConfig = {}
): Promise<string> {
  const client = createSecretsClient(config);
  const command = new GetSecretValueCommand({ SecretId: secretName });
  const response = await client.send(command);

  if (!response.SecretString) {
    throw new Error(`Secret ${secretName} has no string value`);
  }

  return response.SecretString;
}

/**
 * Fetches the Redis URL from AWS Secrets Manager.
 */
export async function getRedisUrl(
  secretName: string,
  config: SecretsConfig = {}
): Promise<string> {
  const secretValue = await getSecret(secretName, config);

  // Try to parse as JSON first
  try {
    const parsed = JSON.parse(secretValue);

    if (typeof parsed === "string") {
      return parsed;
    }
    if (parsed.url) {
      return parsed.url;
    }
    if (parsed.connectionString) {
      return parsed.connectionString;
    }
    if (parsed.host) {
      const port = parsed.port ?? 6379;
      const password = parsed.password ? `:${parsed.password}` : "";
      const username = parsed.username ?? "";
      const tls = parsed.tls ? "rediss" : "redis";
      const auth = password ? `${username}${password}@` : "";
      return `${tls}://${auth}${parsed.host}:${port}`;
    }
  } catch {
    // Not JSON, treat as raw connection string
    return secretValue;
  }

  throw new Error(
    `Secret ${secretName} has unrecognized format. Expected url, connectionString, host, or raw connection string.`
  );
}

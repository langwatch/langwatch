import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const AWS_REGION = "eu-central-1";

export type Environment = "dev" | "staging" | "prod";

interface SecretsConfig {
  profile?: string;
  region?: string;
}

/**
 * Creates an AWS Secrets Manager client with the specified profile.
 *
 * @example
 * const client = createSecretsClient({ profile: "lw-dev" });
 */
function createSecretsClient(config: SecretsConfig): SecretsManagerClient {
  const { profile, region = AWS_REGION } = config;

  // Set AWS_PROFILE environment variable for credential resolution
  if (profile) {
    process.env.AWS_PROFILE = profile;
  }

  return new SecretsManagerClient({ region });
}

/**
 * Fetches a secret value from AWS Secrets Manager.
 *
 * @example
 * const password = await getSecret("langwatch/dev/clickhouse-password", { profile: "lw-dev" });
 */
export async function getSecret(
  secretName: string,
  config: SecretsConfig = {},
): Promise<string> {
  const client = createSecretsClient(config);

  const command = new GetSecretValueCommand({ SecretId: secretName });
  const response = await client.send(command);

  if (!response.SecretString) {
    throw new Error(`Secret ${secretName} has no string value`);
  }

  return JSON.parse(response.SecretString).password;
}

/**
 * Fetches the ClickHouse password for a given environment.
 *
 * @example
 * const password = await getClickHousePassword("dev", { profile: "lw-dev" });
 */
export async function getClickHousePassword(
  env: Environment,
  config: SecretsConfig = {},
): Promise<string> {
  const secretName = process.env.CLICKHOUSE_SECRET_NAME ?? "";
  return getSecret(secretName, config);
}

/**
 * Returns the ClickHouse host for a given environment.
 *
 * @example
 * const host = getClickHouseHost("dev");
 */
export function getClickHouseHost(env: Environment): string {
  return process.env.CLICKHOUSE_URL_READ_ONLY ?? "";
}


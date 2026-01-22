import IORedis from "ioredis";
import { startPortForward, stopPortForward } from "./portForward.js";
import { type Environment, getEnvironmentConfig } from "./environments.js";
import { getRedisUrl } from "./secrets.js";

let connection: IORedis | undefined;
let usingPortForward = false;

export async function getConnection(env: Environment): Promise<IORedis> {
  if (connection) {
    return connection;
  }

  const config = getEnvironmentConfig(env);
  let redisUrl: string;

  if (config.usePortForward) {
    // Start port forwarding and connect to localhost
    const localPort = await startPortForward({ localPort: 6378 });
    usingPortForward = true;
    redisUrl = `redis://localhost:${localPort}`;
  } else if (config.useAwsSecrets && config.secretName) {
    // Get Redis URL from AWS Secrets Manager
    console.log(`Fetching Redis credentials from AWS (profile: ${config.awsProfile})...`);
    redisUrl = await getRedisUrl(config.secretName, { profile: config.awsProfile });
  } else if (config.redisUrl) {
    redisUrl = config.redisUrl;
  } else {
    throw new Error(`No Redis URL configured for environment: ${env}`);
  }

  connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    offlineQueue: false,
    tls: redisUrl.includes("tls.rejectUnauthorized=false")
      ? { rejectUnauthorized: false }
      : redisUrl.includes("rediss://")
        ? {}
        : undefined,
  });

  return connection;
}

export async function closeConnection(): Promise<void> {
  if (connection) {
    await connection.quit();
    connection = undefined;
  }

  if (usingPortForward) {
    stopPortForward();
    usingPortForward = false;
  }
}

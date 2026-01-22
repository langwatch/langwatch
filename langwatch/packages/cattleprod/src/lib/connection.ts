import IORedis from "ioredis";
import { startPortForward, stopPortForward } from "./portForward.js";
import { type Environment, getEnvironmentConfig } from "./environments.js";
import { getRedisUrl } from "./secrets.js";

let connection: IORedis | undefined;
let usingPortForward = false;

function getEnvConfig(env: Environment): { secretName: string; profile: string } {
  const prefix = env.toUpperCase();
  const secretName = process.env[`${prefix}_REDIS_SECRET_NAME`];
  const profile = process.env[`${prefix}_AWS_PROFILE`] ?? `lw-${env}`;

  if (!secretName) {
    throw new Error(
      `${prefix}_REDIS_SECRET_NAME environment variable is not set. ` +
      `Check your .env file.`
    );
  }

  return { secretName, profile };
}

export async function getConnection(env: Environment): Promise<IORedis> {
  if (connection) {
    return connection;
  }

  const config = getEnvironmentConfig(env);
  let redisUrl: string;

  if (env === "local") {
    // Local development - connect to localhost Redis
    redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  } else if (config.usePortForward) {
    // Start port forwarding and connect to localhost
    const localPort = await startPortForward({ localPort: 6378 });
    usingPortForward = true;
    redisUrl = `redis://localhost:${localPort}`;
  } else {
    // AWS environments - get URL from secrets
    const { secretName, profile } = getEnvConfig(env);
    redisUrl = await getRedisUrl(secretName, { profile });
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

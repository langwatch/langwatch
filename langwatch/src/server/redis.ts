import IORedis, { Cluster } from "ioredis";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { env } from "../env.mjs";
import { createLogger } from "../utils/logger";

const logger = createLogger("langwatch:redis");

/**
 * Determines if Redis connection should be skipped.
 * Uses process.env directly to avoid triggering @t3-oss/env validation at module load.
 * This prevents false "client-side access" errors during vitest execution.
 */
function shouldSkipRedis(): boolean {
  // During Next.js build phase
  if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) return true;

  // During unit/integration tests (set in vitest.config.ts)
  if (process.env.BUILD_TIME) return true;

  // Explicitly disabled
  if (process.env.SKIP_REDIS) return true;

  // In jsdom environment (vitest with @vitest-environment jsdom)
  // window is defined but we're not actually in a browser - skip Redis
  // to avoid @t3-oss/env "client-side access" errors
  if (typeof window !== "undefined") return true;

  // No Redis configuration provided
  if (!process.env.REDIS_URL && !process.env.REDIS_CLUSTER_ENDPOINTS)
    return true;

  return false;
}

export const isBuildOrNoRedis = shouldSkipRedis();

function parseClusterEndpoints(endpointsStr: string) {
  return endpointsStr.split(",").map((raw) => {
    const url = raw.includes("://") ? new URL(raw) : new URL(`redis://${raw}`);
    return { host: url.hostname, port: Number(url.port || 6379) };
  });
}

export let connection: IORedis | Cluster | undefined;

if (!isBuildOrNoRedis) {
  // Use validated env inside this block since Redis is definitely needed
  const useCluster = !!env.REDIS_CLUSTER_ENDPOINTS;
  if (useCluster) {
    const clusterEndpoints = parseClusterEndpoints(
      env.REDIS_CLUSTER_ENDPOINTS ?? "",
    );
    connection = new Cluster(clusterEndpoints, {
      redisOptions: {
        maxRetriesPerRequest: null,
        offlineQueue: false,
      },
      dnsLookup: (address, callback) => callback(null, address),
      scaleReads: "all",
    });

    connection.on("connect", async () => {
      logger.info("cluster connected");
    });

    connection.on("ready", () => {
      logger.info("cluster is ready to accept commands");
    });
  } else {
    connection = new IORedis(env.REDIS_URL ?? "", {
      maxRetriesPerRequest: null,
      offlineQueue: false,
      tls: env.REDIS_URL?.includes("tls.rejectUnauthorized=false")
        ? { rejectUnauthorized: false }
        : (env.REDIS_URL?.includes("rediss://") as any),
    });

    connection.on("connect", () => {
      logger.info("connected");
    });
    connection.on("ready", () => {
      logger.info("ready to accept commands");
    });
  }

  // Common events for both single-node and cluster
  connection?.on("error", (error: Error) => {
    logger.error({ error }, "error");
  });
  connection?.on("close", () => {
    logger.info("connection closed");
  });
  connection?.on("reconnecting", () => {
    logger.info("reconnecting...");
  });
} else {
  // During build time or missing env, disable connection
  connection = undefined;
}

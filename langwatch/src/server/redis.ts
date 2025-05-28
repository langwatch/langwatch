import IORedis, { Cluster } from "ioredis";
import { env } from "../env.mjs";
import { createLogger } from "../utils/logger";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

const logger = createLogger("langwatch:redis");

export const isBuildOrNoRedis =
  process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD ||
  !!process.env.BUILD_TIME ||
  (!env.REDIS_URL && !env.REDIS_CLUSTER_ENDPOINTS);

const useCluster = env.REDIS_CLUSTER_ENDPOINTS;

function parseClusterEndpoints(endpointsStr: string) {
  return endpointsStr.split(",").map((raw) => {
    const url = raw.includes("://") ? new URL(raw) : new URL(`redis://${raw}`);
    return { host: url.hostname, port: Number(url.port || 6379) };
  });
}

export let connection: IORedis | Cluster | undefined;

if (!isBuildOrNoRedis) {
  if (useCluster) {
    const clusterEndpoints = parseClusterEndpoints(
      env.REDIS_CLUSTER_ENDPOINTS ?? ""
    );
    connection = new Cluster(clusterEndpoints, {
      redisOptions: {
        maxRetriesPerRequest: null,
        offlineQueue: false,
      },
      dnsLookup: (address, callback) => callback(null, address),
      scaleReads: 'all'
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

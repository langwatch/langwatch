import IORedis, { Cluster } from "ioredis";
// PHASE_PRODUCTION_BUILD was "phase-production-build" from next/constants
const PHASE_PRODUCTION_BUILD = "phase-production-build";
import { env } from "../env.mjs";
import { createLogger } from "../utils/logger/server";
import { parseRedisDbIndex } from "./redis-db-index";

export { parseRedisDbIndex } from "./redis-db-index";

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

// Dev-only isolation: `pnpm dev` at PORT=5570 lands on DB 1, PORT=5580 on DB 2,
// etc. Prevents multiple worktrees from contending on the same BullMQ queues
// and GroupQueue streams. Cluster mode ignores this (cluster supports only
// DB 0) — we warn below if it's set in that combination.

if (!isBuildOrNoRedis) {
  // Use validated env inside this block since Redis is definitely needed
  const redisDbIndex = parseRedisDbIndex(env.REDIS_DB_INDEX);
  const useCluster = !!env.REDIS_CLUSTER_ENDPOINTS;
  if (useCluster) {
    if (redisDbIndex !== 0) {
      logger.warn(
        { redisDbIndex },
        "REDIS_DB_INDEX is set but REDIS_CLUSTER_ENDPOINTS is active — cluster mode only supports DB 0, ignoring",
      );
    }
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
      db: redisDbIndex,
      tls: env.REDIS_URL?.includes("tls.rejectUnauthorized=false")
        ? { rejectUnauthorized: false }
        : (env.REDIS_URL?.includes("rediss://") as any),
    });

    connection.on("connect", () => {
      logger.info({ db: redisDbIndex }, "connected");
    });
    connection.on("ready", () => {
      logger.info({ db: redisDbIndex }, "ready to accept commands");
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

/**
 * Block server boot until Redis answers a PING, or exit loudly on timeout.
 *
 * When Redis is down (forgot to start compose, wrong REDIS_URL, host port
 * not published) the auth layer swallows the error and the user sees an
 * endless "Redirecting to Sign in..." loop — ten minutes of head-scratching
 * per new contributor. Surfacing the error here converts that into an
 * obvious boot-time failure the developer can action immediately.
 *
 * No-ops in build/test modes where {@link isBuildOrNoRedis} is true.
 */
export async function verifyRedisReady(timeoutMs = 3000): Promise<void> {
  if (isBuildOrNoRedis || !connection) return;
  const target =
    env.REDIS_CLUSTER_ENDPOINTS ??
    env.REDIS_URL ??
    "(unset)";
  try {
    await Promise.race([
      connection.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`PING timeout after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
    logger.info({ target }, "redis ready");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      { error, target },
      `redis unreachable at boot — ${message}\n` +
        `  REDIS_URL / REDIS_CLUSTER_ENDPOINTS points at: ${target}\n` +
        `  Hybrid dev? 'pnpm dev' on host + docker redis needs the host port published (6379).\n` +
        `  Full-compose dev? Run 'make dev' instead of 'pnpm dev'.`,
    );
    // Don't throw in build phase — some tools import start.ts at build time.
    process.exit(1);
  }
}

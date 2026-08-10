import { createLogger } from "@langwatch/observability";
import { pingRedis } from "@langwatch/redis-client";
import { env } from "../../env.mjs";
import { getApp } from "./app";

const logger = createLogger("langwatch:redis");

/**
 * Probes the App's Redis connection, rejecting on failure.
 *
 * Boot paths that own the process decide what a rejection means — `start.ts`
 * exits, `startWorkers()` lets it propagate so an in-process worker boot failure
 * does not take the serving web process down with it. Nothing here exits, by
 * design (ADR-090).
 *
 * No-ops when the App has no Redis configured.
 */
export async function assertRedisReady(timeoutMs?: number): Promise<void> {
  await pingRedis({
    connection: getApp().redis,
    timeoutMs,
    target: env.REDIS_CLUSTER_ENDPOINTS ?? env.REDIS_URL ?? "(unset)",
    logger,
  });
}

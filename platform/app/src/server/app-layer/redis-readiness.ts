import { createLogger } from "@langwatch/observability";
import { RedisReadinessService } from "@langwatch/redis-client";
import type { App } from "./app";

const logger = createLogger("langwatch:redis");

// Safe at module scope: the service owns a logger and nothing else. It holds no
// connection and opens no socket — the connection arrives per call, from the App.
const readiness = new RedisReadinessService({ logger });

/**
 * Probes the App's Redis connection, rejecting on failure.
 *
 * Boot paths that own the process decide what a rejection means — `start.ts`
 * exits, `startWorkers()` lets it propagate so an in-process worker boot failure
 * does not take the serving web process down with it. Nothing here exits, by
 * design (ADR-093).
 *
 * No-ops when the App has no Redis configured.
 */
export async function assertRedisReady({
  app,
  timeoutMs,
}: {
  app: App;
  timeoutMs?: number;
}): Promise<void> {
  await readiness.ping({
    connection: app.redis,
    timeoutMs,
    target: "App.redis",
  });
}

import { createLogger } from "@langwatch/observability";
import type { Cluster, Redis } from "ioredis";
import { runSystemMigrationPass } from "./runtime";

const logger = createLogger("langwatch:system-migrations:boot");

/**
 * Kick one migration pass in the background at worker boot - level
 * triggered: every boot re-attempts held and parked tenants, so the fleet
 * converges on finalized without anyone running anything. The pass never
 * blocks boot and never throws out of here; a failed pass is a logged
 * no-op that the next boot repeats.
 *
 * Composed by the app layer (presets.ts) alongside the other worker-only
 * background loops, and torn down through the App's graceful closeables.
 */
export function startSystemMigrations(args?: {
  redis?: Redis | Cluster | null;
}): { stop: () => Promise<void> } {
  const controller = new AbortController();
  const pass = runSystemMigrationPass({
    signal: controller.signal,
    redis: args?.redis,
  })
    .then((summary) => {
      if (summary) {
        logger.info({ summary }, "system migration pass finished");
      }
    })
    .catch((error) => {
      logger.error(
        { error },
        "system migration pass failed; next boot retries",
      );
    });
  return {
    stop: async () => {
      controller.abort();
      await pass;
    },
  };
}

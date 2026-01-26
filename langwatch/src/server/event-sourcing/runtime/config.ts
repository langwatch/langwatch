import type { ClickHouseClient } from "@clickhouse/client";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
// Note: getClickHouseClient and connection are NOT imported here to avoid
// module-level env validation. They are lazy-loaded in getEventSourcingRuntime().

export interface EventSourcingConfig {
  enabled: boolean;
  clickHouseEnabled: boolean;
  forceClickHouseInTests: boolean;
  isTestEnvironment: boolean;
  isBuildTime: boolean;
  clickHouseClient?: ClickHouseClient;
  redisConnection?: IORedis | Cluster;
}

/**
 * Options for createEventSourcingConfig to inject pre-resolved clients.
 * This allows lazy loading of clients to avoid module-level env validation.
 */
export interface EventSourcingConfigOptions {
  clickHouseClient?: ClickHouseClient | null;
  redisConnection?: IORedis | Cluster | null;
}

/**
 * Detects if we're in Next.js build phase.
 * During build, we should not initialize stores that require external services.
 */
function isBuildPhase(): boolean {
  return (
    process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD ||
    !!process.env.BUILD_TIME
  );
}

export function createEventSourcingConfig(
  options?: EventSourcingConfigOptions,
): EventSourcingConfig {
  const isBuildTime = isBuildPhase();
  const isTestEnvironment =
    process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);

  // Only check explicit disable flag - lazy init handles build-time safety
  const enabled = process.env.ENABLE_EVENT_SOURCING !== "false";
  const clickHouseEnabled = process.env.ENABLE_CLICKHOUSE !== "false";
  const forceClickHouseInTests =
    process.env.TEST_FORCE_CLICKHOUSE_CHECKPOINTS === "true";

  return {
    enabled,
    clickHouseEnabled,
    forceClickHouseInTests,
    isTestEnvironment,
    isBuildTime,
    clickHouseClient: options?.clickHouseClient ?? undefined,
    redisConnection: options?.redisConnection ?? undefined,
  };
}

import type { ClickHouseClient } from "@clickhouse/client";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { getClickHouseClient } from "../../clickhouse/client";
import { connection } from "../../redis";

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
 * Detects if we're in Next.js build phase.
 * During build, we should not initialize stores that require external services.
 */
function isBuildPhase(): boolean {
  return (
    process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD ||
    !!process.env.BUILD_TIME
  );
}

export function createEventSourcingConfig(): EventSourcingConfig {
  const isBuildTime = isBuildPhase();
  const isTestEnvironment =
    process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);

  // Only check explicit disable flag - lazy init handles build-time safety
  const enabled = process.env.ENABLE_EVENT_SOURCING !== "false";
  const clickHouseEnabled = process.env.ENABLE_CLICKHOUSE !== "false";
  const forceClickHouseInTests =
    process.env.TEST_FORCE_CLICKHOUSE_CHECKPOINTS === "true";

  // Only attempt to get ClickHouse client if enabled and not in build phase
  const resolvedClickHouseClient =
    enabled && clickHouseEnabled && !isBuildTime ? getClickHouseClient() : null;

  return {
    enabled,
    clickHouseEnabled,
    forceClickHouseInTests,
    isTestEnvironment,
    isBuildTime,
    clickHouseClient: resolvedClickHouseClient ?? void 0,
    redisConnection: isBuildTime ? void 0 : (connection ?? void 0),
  };
}

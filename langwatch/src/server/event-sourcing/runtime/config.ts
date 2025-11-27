import type { ClickHouseClient } from "@clickhouse/client";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import { getClickHouseClient } from "~/utils/clickhouse";
import { connection } from "../../redis";

export interface EventSourcingConfig {
  enabled: boolean;
  clickHouseEnabled: boolean;
  forceClickHouseInTests: boolean;
  isTestEnvironment: boolean;
  clickHouseClient?: ClickHouseClient;
  redisConnection?: IORedis | Cluster;
}

export function createEventSourcingConfig(): EventSourcingConfig {
  const enabled = process.env.ENABLE_EVENT_SOURCING !== "false";
  const clickHouseEnabled = process.env.ENABLE_CLICKHOUSE !== "false";
  const forceClickHouseInTests =
    process.env.TEST_FORCE_CLICKHOUSE_CHECKPOINTS === "true";
  const isTestEnvironment =
    process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);

  const resolvedClickHouseClient =
    enabled && clickHouseEnabled ? getClickHouseClient() : null;

  return {
    enabled,
    clickHouseEnabled,
    forceClickHouseInTests,
    isTestEnvironment,
    clickHouseClient: resolvedClickHouseClient ?? void 0,
    redisConnection: connection ?? void 0,
  };
}

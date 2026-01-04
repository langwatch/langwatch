export { BaseMemoryProjectionStore } from "./baseMemoryRepository";
export type { SpanRepository } from "./spanRepository";
export { SpanRepositoryClickHouse } from "./spanRepositoryClickHouse";
export { SpanRepositoryMemory } from "./spanRepositoryMemory";

export type { TraceDailyUsageRepository } from "./traceDailyUsageRepository";
export { TraceDailyUsageRepositoryPostgres } from "./traceDailyUsageRepositoryPostgres";
export { TraceDailyUsageRepositoryMemory } from "./traceDailyUsageRepositoryMemory";

export type { TraceSummaryRepository } from "./traceSummaryRepository";
export { TraceSummaryRepositoryClickHouse } from "./traceSummaryRepositoryClickHouse";
export { TraceSummaryRepositoryMemory } from "./traceSummaryRepositoryMemory";

import { getClickHouseClient } from "~/server/clickhouse/client";
import type { SpanRepository } from "./spanRepository";
import { SpanRepositoryClickHouse } from "./spanRepositoryClickHouse";
import { SpanRepositoryMemory } from "./spanRepositoryMemory";
import type { TraceSummaryRepository } from "./traceSummaryRepository";
import { TraceSummaryRepositoryClickHouse } from "./traceSummaryRepositoryClickHouse";
import { TraceSummaryRepositoryMemory } from "./traceSummaryRepositoryMemory";
import { env } from "~/env.mjs";
import type { TraceDailyUsageRepository } from "./traceDailyUsageRepository";
import { TraceDailyUsageRepositoryPostgres } from "./traceDailyUsageRepositoryPostgres";
import { TraceDailyUsageRepositoryMemory } from "./traceDailyUsageRepositoryMemory";

const clickHouseClient = getClickHouseClient();

export const spanRepository: SpanRepository = clickHouseClient
  ? new SpanRepositoryClickHouse(clickHouseClient)
  : new SpanRepositoryMemory();

export const traceSummaryRepository: TraceSummaryRepository = clickHouseClient
  ? new TraceSummaryRepositoryClickHouse(clickHouseClient)
  : new TraceSummaryRepositoryMemory();

export const traceDailyUsageRepository: TraceDailyUsageRepository =
  env.DATABASE_URL
    ? new TraceDailyUsageRepositoryPostgres()
    : new TraceDailyUsageRepositoryMemory();

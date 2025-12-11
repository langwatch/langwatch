export { BaseMemoryProjectionStore } from "./baseMemoryRepository";
export type { SpanRepository, StoreSpanData } from "./spanRepository";
export { SpanRepositoryClickHouse } from "./spanRepositoryClickHouse";
export { SpanRepositoryMemory } from "./spanRepositoryMemory";

export type { TraceSummaryRepository } from "./traceSummaryRepository";
export { TraceSummaryRepositoryClickHouse } from "./traceSummaryRepositoryClickHouse";
export { TraceSummaryRepositoryMemory } from "./traceSummaryRepositoryMemory";

export type { DailyTraceCountRepository } from "./dailyTraceCountRepository";
export { DailyTraceCountRepositoryClickHouse } from "./dailyTraceCountRepositoryClickHouse";
export { DailyTraceCountRepositoryMemory } from "./dailyTraceCountRepositoryMemory";

import { getClickHouseClient } from "~/server/clickhouse/client";
import type { DailyTraceCountRepository } from "./dailyTraceCountRepository";
import { DailyTraceCountRepositoryClickHouse } from "./dailyTraceCountRepositoryClickHouse";
import { DailyTraceCountRepositoryMemory } from "./dailyTraceCountRepositoryMemory";
import type { TraceSummaryRepository } from "./traceSummaryRepository";
import { TraceSummaryRepositoryClickHouse } from "./traceSummaryRepositoryClickHouse";
import { TraceSummaryRepositoryMemory } from "./traceSummaryRepositoryMemory";

const clickHouseClient = getClickHouseClient();

export const traceSummaryRepository: TraceSummaryRepository = clickHouseClient
  ? new TraceSummaryRepositoryClickHouse(clickHouseClient)
  : new TraceSummaryRepositoryMemory();

export const dailyTraceCountRepository: DailyTraceCountRepository =
  clickHouseClient
    ? new DailyTraceCountRepositoryClickHouse(clickHouseClient)
    : new DailyTraceCountRepositoryMemory();

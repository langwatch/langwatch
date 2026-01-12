export { BaseMemoryProjectionStore } from "./baseMemoryRepository";
export type { SpanRepository } from "./spanRepository";
export { SpanRepositoryClickHouse } from "./spanRepositoryClickHouse";
export { SpanRepositoryMemory } from "./spanRepositoryMemory";

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


const clickHouseClient = getClickHouseClient();

export const spanRepository: SpanRepository = clickHouseClient
  ? new SpanRepositoryClickHouse(clickHouseClient)
  : new SpanRepositoryMemory();

export const traceSummaryRepository: TraceSummaryRepository = clickHouseClient
  ? new TraceSummaryRepositoryClickHouse(clickHouseClient)
  : new TraceSummaryRepositoryMemory();

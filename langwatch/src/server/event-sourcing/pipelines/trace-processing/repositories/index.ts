export type { SpanRepository, StoreSpanData } from "./spanRepository";
export { SpanRepositoryClickHouse } from "./spanRepositoryClickHouse";
export { SpanRepositoryMemory } from "./spanRepositoryMemory";

export type { TraceSummaryRepository } from "./traceSummaryRepository";
export { TraceSummaryRepositoryClickHouse } from "./traceSummaryRepositoryClickHouse";
export { TraceSummaryRepositoryMemory } from "./traceSummaryRepositoryMemory";

import { getClickHouseClient } from "~/server/clickhouse/client";
import { TraceSummaryRepositoryClickHouse } from "./traceSummaryRepositoryClickHouse";
import { TraceSummaryRepositoryMemory } from "./traceSummaryRepositoryMemory";
import type { TraceSummaryRepository } from "./traceSummaryRepository";

const clickHouseClient = getClickHouseClient();

export const traceSummaryRepository: TraceSummaryRepository = clickHouseClient
  ? new TraceSummaryRepositoryClickHouse(clickHouseClient)
  : new TraceSummaryRepositoryMemory();

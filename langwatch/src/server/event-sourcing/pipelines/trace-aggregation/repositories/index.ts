export type { TraceSummaryStateProjectionRepository } from "./traceSummaryStateProjectionRepository";
export { TraceSummaryStateProjectionRepositoryClickHouse } from "./traceSummaryStateProjectionRepositoryClickHouse";

import { getClickHouseClient } from "~/server/clickhouse/client";
import { TraceSummaryStateProjectionRepositoryClickHouse } from "./traceSummaryStateProjectionRepositoryClickHouse";
import { TraceSummaryStateProjectionRepositoryMemory } from "./traceSummaryStateProjectionRepositoryMemory";
import type { TraceSummaryStateProjectionRepository } from "./traceSummaryStateProjectionRepository";

const clickHouseClient = getClickHouseClient();

export const traceSummaryStateProjectionRepository: TraceSummaryStateProjectionRepository =
  clickHouseClient
    ? new TraceSummaryStateProjectionRepositoryClickHouse(clickHouseClient)
    : new TraceSummaryStateProjectionRepositoryMemory();

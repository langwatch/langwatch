export type { TraceAggregationStateProjectionRepository } from "./traceAggregationStateProjectionRepository";
export { TraceAggregationStateProjectionRepositoryClickHouse } from "./traceAggregationStateProjectionRepositoryClickHouse";
export { TraceAggregationStateProjectionRepositoryMemory } from "./traceAggregationStateProjectionRepositoryMemory";

import { getClickHouseClient } from "../../../../../utils/clickhouse";
import type { TraceAggregationStateProjectionRepository } from "./traceAggregationStateProjectionRepository";
import { TraceAggregationStateProjectionRepositoryClickHouse } from "./traceAggregationStateProjectionRepositoryClickHouse";
import { TraceAggregationStateProjectionRepositoryMemory } from "./traceAggregationStateProjectionRepositoryMemory";

const clickHouseClient = getClickHouseClient();
export const traceAggregationStateProjectionRepository: TraceAggregationStateProjectionRepository =
  clickHouseClient
    ? new TraceAggregationStateProjectionRepositoryClickHouse(clickHouseClient)
    : new TraceAggregationStateProjectionRepositoryMemory();

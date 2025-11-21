export type { TraceAggregationStateProjectionRepository } from "./traceAggregationStateProjectionRepository";
export { TraceAggregationStateProjectionRepositoryMemory } from "./traceAggregationStateProjectionRepositoryMemory";
export { TraceAggregationStateProjectionRepositoryClickHouse } from "./traceAggregationStateProjectionRepositoryClickHouse";
import { getClickHouseClient } from "../../../../../utils/clickhouse";
import { TraceAggregationStateProjectionRepositoryClickHouse } from "./traceAggregationStateProjectionRepositoryClickHouse";
import { TraceAggregationStateProjectionRepositoryMemory } from "./traceAggregationStateProjectionRepositoryMemory";
import type { TraceAggregationStateProjectionRepository } from "./traceAggregationStateProjectionRepository";

const clickHouseClient = getClickHouseClient();
export const traceAggregationStateProjectionRepository: TraceAggregationStateProjectionRepository =
  clickHouseClient
    ? new TraceAggregationStateProjectionRepositoryClickHouse(clickHouseClient)
    : new TraceAggregationStateProjectionRepositoryMemory();

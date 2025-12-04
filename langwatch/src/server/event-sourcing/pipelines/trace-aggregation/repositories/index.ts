export type { TraceAggregationStateProjectionRepository } from "./traceAggregationStateProjectionRepository";
export { TraceAggregationStateProjectionRepositoryClickHouse } from "./traceAggregationStateProjectionRepositoryClickHouse";
import { getClickHouseClient } from "../../../../clickhouse/client";
import { TraceAggregationStateProjectionRepositoryClickHouse } from "./traceAggregationStateProjectionRepositoryClickHouse";
import { TraceAggregationStateProjectionRepositoryMemory } from "./traceAggregationStateProjectionRepositoryMemory";

const clickHouseClient = getClickHouseClient();
export const traceAggregationStateProjectionRepository: TraceAggregationStateProjectionRepository =
  clickHouseClient
    ? new TraceAggregationStateProjectionRepositoryClickHouse(clickHouseClient)
    : new TraceAggregationStateProjectionRepositoryMemory();

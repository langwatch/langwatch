import type { ClickHouseClient as RawClickHouseClient } from "@clickhouse/client";
import {
  type ClickHouseClient,
  createRowCodec,
  type EventLogRow,
  eventLogTable,
} from "@langwatch/clickhouse";
import { SIMULATION_RUN_PIPELINE_NAME } from "~/server/event-sourcing/simulation-processing/events";
import {
  type SimulationRunsRow,
  simulationRunsTable,
} from "~/server/event-sourcing/simulation-processing/table";

const codec = createRowCodec();

/** Point read on the deployed `simulation_runs` table. `FINAL` collapses the
 * `ReplacingMergeTree` at read time rather than waiting on a background
 * merge or an explicit `OPTIMIZE`. */
export async function readSimulationRun(args: {
  readonly client: ClickHouseClient;
  readonly tenantId: string;
  readonly scenarioRunId: string;
}): Promise<SimulationRunsRow | null> {
  const result = await args.client.query({
    tenantId: args.tenantId,
    sql:
      `SELECT ${simulationRunsTable.columnNames.join(", ")} FROM simulation_runs FINAL ` +
      `WHERE TenantId = {tenantId:String} AND ScenarioRunId = {scenarioRunId:String}`,
    params: { tenantId: args.tenantId, scenarioRunId: args.scenarioRunId },
  });
  if (result.rows.length === 0) return null;
  const [decoded] = codec.decodeRows<SimulationRunsRow>({
    columns: simulationRunsTable.wireColumns,
    columnNames: simulationRunsTable.columnNames,
    header: result.header,
    rows: result.rows,
  });
  return decoded ?? null;
}

/** Same `FINAL` collapse over `event_log`, scoped to one aggregate. */
export async function readEventLogRows(args: {
  readonly client: ClickHouseClient;
  readonly tenantId: string;
  readonly aggregateId: string;
}): Promise<EventLogRow[]> {
  const result = await args.client.query({
    tenantId: args.tenantId,
    sql:
      `SELECT ${eventLogTable.columnNames.join(", ")} FROM event_log FINAL ` +
      `WHERE TenantId = {tenantId:String} AND AggregateType = {aggregateType:String} AND AggregateId = {aggregateId:String}`,
    params: {
      tenantId: args.tenantId,
      aggregateType: SIMULATION_RUN_PIPELINE_NAME,
      aggregateId: args.aggregateId,
    },
  });
  if (result.rows.length === 0) return [];
  return codec.decodeRows<EventLogRow>({
    columns: eventLogTable.wireColumns,
    columnNames: eventLogTable.columnNames,
    header: result.header,
    rows: result.rows,
  });
}

/** `cleanupTestData(tenantId)` (test-utils/integration/testContainers.ts)
 * scopes to `event_log`/`stored_spans`/`trace_summaries` only — it predates
 * this rewrite's tables, so `simulation_runs` needs its own teardown. Goes
 * through the raw driver client because the `@langwatch/clickhouse` port has
 * no DDL/mutation surface, only `query`/`insert`. */
export async function deleteSimulationRunsFor(
  rawClient: RawClickHouseClient,
  tenantId: string,
): Promise<void> {
  await rawClient.exec({
    query: `ALTER TABLE simulation_runs DELETE WHERE TenantId = {tenantId:String}`,
    query_params: { tenantId },
  });
}

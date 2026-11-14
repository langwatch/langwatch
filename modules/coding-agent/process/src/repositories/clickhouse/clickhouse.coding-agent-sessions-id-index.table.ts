import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

const moment = () => column.dateTime64({ precision: 3 });

/**
 * `coding_agent_sessions_id_index`, owned by coding-agent (goose 00117): AggregatingMergeTree over
 * (TenantId, SessionId), the earliest and latest StartedAt each session's versions span.
 */
export const codingAgentSessionsIdIndex = defineClickHouseTable({
  name: "coding_agent_sessions_id_index",
  tenantColumn: "TenantId",
  sortKey: ["TenantId", "SessionId"],
  columns: {
    TenantId: column.string(),
    SessionId: column.string(),
    FromAt: column.simpleAggregate({ fn: "min", of: moment() }),
    ToAt: column.simpleAggregate({ fn: "max", of: moment() }),
    _retention_days: column.simpleAggregate({ fn: "max", of: column.uint16() }),
  },
});

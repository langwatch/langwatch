// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * `governance_kpis`, owned by governance (goose 00031): ReplacingMergeTree(LastEventOccurredAt)
 * over (TenantId, SourceId, HourBucket, TraceId), partitioned by HourBucket, a sort key column.
 */
import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

const moment = () => column.dateTime64({ precision: 3 });

export const governanceKpis = defineClickHouseTable({
  name: "governance_kpis",
  tenantColumn: "TenantId",
  versionColumn: "LastEventOccurredAt",
  sortKey: ["TenantId", "SourceId", "HourBucket", "TraceId"],
  columns: {
    TenantId: column.string(),
    SourceId: column.string(),
    HourBucket: column.dateTime(),
    TraceId: column.string(),
    SourceType: column.lowCardinalityString(),
    SpendUsd: column.float64(),
    PromptTokens: column.uint64(),
    CompletionTokens: column.uint64(),
    CreatedAt: moment(),
    LastEventOccurredAt: moment(),
  },
});

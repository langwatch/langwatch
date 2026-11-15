/**
 * ADR-202, "Tables are typed descriptors": every column analytics' descriptors declare exists on
 * the migrated schema with the type it is declared as, so a descriptor cannot drift from goose.
 * @integration
 * @vitest-environment node
 */
import type { ClickHouseTableFacts } from "@langwatch/clickhouse-client/builder";
import { describe, expect, it } from "vitest";

import { startMigratedClickHouse } from "../../../__tests__/migrated-clickhouse.harness.ts";
import { evaluationAnalyticsRollup } from "../clickhouse.evaluation-analytics-rollup.table.ts";
import { evaluationAnalytics } from "../clickhouse.evaluation-analytics.table.ts";
import { evaluationRuns } from "../clickhouse.evaluation-runs.table.ts";
import { storedSpans } from "../clickhouse.stored-spans.table.ts";
import { traceAnalyticsRollup } from "../clickhouse.trace-analytics-rollup.table.ts";
import { traceAnalytics } from "../clickhouse.trace-analytics.table.ts";
import { traceSummaries } from "../clickhouse.trace-summaries.table.ts";

const DESCRIPTORS: readonly { readonly $table: ClickHouseTableFacts }[] = [
  evaluationAnalytics,
  evaluationAnalyticsRollup,
  // Declared shares (clickhouse-table-ownership.ts): only the columns analytics reads.
  traceAnalytics,
  traceAnalyticsRollup,
  traceSummaries,
  storedSpans,
  evaluationRuns,
];

/**
 * The parameter type a stored column binds as: storage wrappers that change no value go, a time
 * (an array's members too) binds as epoch milliseconds, and a FixedString binds as String.
 */
const bindingOf = (type: string): string =>
  type
    .replace(/^SimpleAggregateFunction\(\w+, (.+)\)$/, "$1")
    .replaceAll(/LowCardinality\(([^()]*(?:\([^()]*\))?)\)/g, "$1")
    .replaceAll(/Nullable\(([^()]*(?:\([^()]*\))?)\)/g, "$1")
    .replaceAll(/DateTime64\(\d\)/g, "Int64")
    .replace(/^FixedString\(\d+\)$/, "String");

describe("analytics' descriptors against the migrated schema", () => {
  it.each(DESCRIPTORS.map((table) => [table.$table.stored, table] as const))(
    "declares only %s columns the schema has, binding as their stored types",
    async (name, table) => {
      const { client } = await startMigratedClickHouse();
      const result = await client.query({
        query:
          "SELECT name, type FROM system.columns WHERE database = currentDatabase() AND table = {table:String}",
        query_params: { table: name },
        format: "JSONEachRow",
      });
      const stored = new Map(
        ((await result.json()) as { name: string; type: string }[]).map((each) => [
          each.name,
          bindingOf(each.type),
        ]),
      );
      const declared = Object.fromEntries(
        table.$table.columns.map((each) => {
          const ref = Reflect.get(table, each) as { binding: { paramType: string } };
          return [each, ref.binding.paramType];
        }),
      );

      expect(declared).toEqual(
        Object.fromEntries(table.$table.columns.map((each) => [each, stored.get(each)])),
      );
    },
  );
});

/**
 * ADR-202, "Tables are typed descriptors": every column evaluation's descriptors declare exists on
 * the migrated schema with the type it is declared as, so a descriptor cannot drift from goose.
 */
import type { ClickHouseTableFacts } from "@langwatch/clickhouse-client/builder";
import { describe, expect, it } from "vitest";

import { startMigratedClickHouse } from "../../../__tests__/support/monitor-performance.fixtures.ts";
import { evaluationRuns } from "../clickhouse.evaluation-runs.table.ts";
import { traceSummaries } from "../clickhouse.trace-summaries.table.ts";

const DESCRIPTORS: readonly { readonly $table: ClickHouseTableFacts }[] = [
  evaluationRuns,
  // A named exception (clickhouse-table-ownership.ts): only the columns evaluation reads.
  traceSummaries,
];

/** The parameter type a stored column binds as: storage wrappers that change no value go. */
const bindingOf = (type: string): string =>
  type
    .replace(/^SimpleAggregateFunction\(\w+, (.+)\)$/, "$1")
    .replaceAll(/LowCardinality\(([^()]*(?:\([^()]*\))?)\)/g, "$1")
    .replaceAll(/Nullable\(([^()]*(?:\([^()]*\))?)\)/g, "$1")
    .replace(/^DateTime64\(\d\)$/, "Int64")
    .replace(/^FixedString\(\d+\)$/, "String");

describe("evaluation's descriptors against the migrated schema", () => {
  it.each(DESCRIPTORS.map((table) => [table.$table.stored, table] as const))(
    "declares only %s columns the schema has, binding as their stored types",
    async (name, table) => {
      const client = await startMigratedClickHouse();
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
    180_000,
  );
});

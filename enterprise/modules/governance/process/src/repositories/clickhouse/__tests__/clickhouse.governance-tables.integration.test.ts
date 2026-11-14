// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * ADR-202, "Tables are typed descriptors": every column governance's descriptors declare exists
 * on the migrated schema with the type it binds as, so a descriptor cannot drift from goose.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { ClickHouseTableFacts } from "@langwatch/clickhouse-client/builder";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startMigratedClickHouse } from "../../../__tests__/migrated-clickhouse.harness.ts";
import { governanceCostRollup1d } from "../clickhouse.governance-cost-rollup-1d.table.ts";
import { governanceCostRollupCharges } from "../clickhouse.governance-cost-rollup-charges.table.ts";
import { governanceCostRollupRestatementIndex } from "../clickhouse.governance-cost-rollup-restatement-index.table.ts";
import { governanceKpis } from "../clickhouse.governance-kpis.table.ts";
import { governanceOcsfEvents } from "../clickhouse.governance-ocsf-events.table.ts";

const DESCRIPTORS: readonly { readonly $table: ClickHouseTableFacts }[] = [
  governanceOcsfEvents,
  governanceKpis,
  governanceCostRollup1d,
  governanceCostRollupRestatementIndex,
  governanceCostRollupCharges,
];

/** The parameter type a stored column binds as: storage wrappers that change no value go. */
const bindingOf = (type: string): string =>
  type
    .replaceAll(/LowCardinality\(([^()]*(?:\([^()]*\))?)\)/g, "$1")
    .replaceAll(/Nullable\(([^()]*(?:\([^()]*\))?)\)/g, "$1")
    .replace(/^DateTime64\(\d\)$/, "Int64")
    .replace(/^DateTime$/, "Int64");

describe("governance's descriptors against the migrated schema", () => {
  let client: ClickHouseClient;

  beforeAll(async () => {
    client = await startMigratedClickHouse({ suite: "governance-descriptors" });
  }, 240_000);

  afterAll(async () => {
    await client?.close();
  });

  it.each(DESCRIPTORS.map((table) => [table.$table.stored, table] as const))(
    "declares every %s column the schema has, binding as its stored type",
    async (name, table) => {
      const result = await client.query({
        query:
          "SELECT name, type FROM system.columns WHERE database = currentDatabase() AND table = {table:String}",
        query_params: { table: name },
        format: "JSONEachRow",
      });
      const stored = Object.fromEntries(
        ((await result.json()) as { name: string; type: string }[])
          // `_retention_days` and `_size_bytes` are retention plumbing (ADR-024), never read here.
          .filter((each) => !each.name.startsWith("_"))
          .map((each) => [each.name, bindingOf(each.type)]),
      );
      const declared = Object.fromEntries(
        table.$table.columns.map((each) => {
          const ref = Reflect.get(table, each) as { binding: { paramType: string } };
          return [each, ref.binding.paramType];
        }),
      );

      expect(declared).toEqual(stored);
    },
    60_000,
  );
});

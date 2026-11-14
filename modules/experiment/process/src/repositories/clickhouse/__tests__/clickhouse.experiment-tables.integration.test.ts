/** @vitest-environment node */

/**
 * ADR-202, "Tables are typed descriptors": every column experiment's descriptors declare exists
 * on the migrated schema with the type it is declared as, so a descriptor cannot drift from goose.
 */
import type { ClickHouseTableFacts } from "@langwatch/clickhouse-client/builder";
import { beforeAll, describe, expect, it } from "vitest";

import {
  type MigratedClickHouse,
  startMigratedClickHouse,
} from "../../../__tests__/migrated-clickhouse.harness.ts";
import { dspySteps } from "../clickhouse.dspy-steps.table.ts";
import { experimentRunItems } from "../clickhouse.experiment-run-items.table.ts";
import { experimentRuns } from "../clickhouse.experiment-runs.table.ts";

const DESCRIPTORS: readonly { readonly $table: ClickHouseTableFacts }[] = [
  experimentRuns,
  experimentRunItems,
  dspySteps,
];

/** The parameter type a stored column binds as: storage wrappers that change no value go. */
const bindingOf = (type: string): string =>
  type
    .replaceAll(/LowCardinality\(([^()]*(?:\([^()]*\))?)\)/g, "$1")
    .replaceAll(/Nullable\(([^()]*(?:\([^()]*\))?)\)/g, "$1")
    .replace(/^DateTime64\(\d\)$/, "Int64");

describe("experiment's descriptors against the migrated schema", () => {
  let migrated: MigratedClickHouse;

  beforeAll(async () => {
    migrated = await startMigratedClickHouse();
  }, 240_000);

  it.each(DESCRIPTORS.map((table) => [table.$table.stored, table] as const))(
    "declares every %s column the schema has, binding as its stored type",
    async (name, table) => {
      const result = await migrated.client.query({
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

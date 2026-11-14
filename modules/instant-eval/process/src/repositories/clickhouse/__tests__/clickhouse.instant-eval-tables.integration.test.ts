/** @vitest-environment node */

/**
 * ADR-202, "Tables are typed descriptors": every column instant-eval's descriptors declare exists
 * on the migrated schema with the type it is declared as, so a descriptor cannot drift from goose.
 */
import type { ClickHouseTableFacts } from "@langwatch/clickhouse-client/builder";
import { describe, expect, it } from "vitest";

import { instantEvalJudgments } from "../clickhouse.instant-eval-judgments.table.ts";
import { instantEvalRuns } from "../clickhouse.instant-eval-runs.table.ts";
import {
  createTestClickHouseClient,
  testClickHouseUrl,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseUrl = testClickHouseUrl();

const DESCRIPTORS: readonly { readonly $table: ClickHouseTableFacts }[] = [
  instantEvalRuns,
  instantEvalJudgments,
];

/** The parameter type a stored column binds as: storage wrappers that change no value go. */
const bindingOf = (type: string): string =>
  type
    .replaceAll(/LowCardinality\(([^()]*(?:\([^()]*\))?)\)/g, "$1")
    .replaceAll(/Nullable\(([^()]*(?:\([^()]*\))?)\)/g, "$1")
    .replace(/^DateTime64\(\d\)$/, "Int64");

describe.skipIf(!clickHouseUrl)("instant-eval's descriptors against the migrated schema", () => {
  it.each(DESCRIPTORS.map((table) => [table.$table.stored, table] as const))(
    "declares every %s column the schema has, binding as its stored type",
    async (name, table) => {
      const client = createTestClickHouseClient(clickHouseUrl as URL);
      try {
        const result = await client.query({
          query:
            "SELECT name, type FROM system.columns WHERE database = currentDatabase() AND table = {table:String}",
          query_params: { table: name },
          format: "JSONEachRow",
        });
        const stored = Object.fromEntries(
          ((await result.json()) as { name: string; type: string }[])
            // `_retention_days` is the retention plumbing (ADR-024), never a column a read names.
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
      } finally {
        await client.close();
      }
    },
    60_000,
  );
});

/**
 * ADR-202, "Tables are typed descriptors": every column evaluation's descriptors declare exists on
 * the migrated schema with the type it is declared as, so a descriptor cannot drift from goose.
 */
import { randomUUID } from "node:crypto";

import type { ClickHouseTableFacts } from "@langwatch/clickhouse-client/builder";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  EVALUATION_ID_INDEXES,
  EVALUATION_SECOND_ID_INDEXES,
} from "../clickhouse.evaluation-id-indexes.database.ts";
import { evaluationRuns } from "../clickhouse.evaluation-runs.table.ts";
import { traceSummaries } from "../clickhouse.trace-summaries.table.ts";
import { EvaluationRunClickHouseReadRepository } from "../evaluation-run-read.repository.ts";
import { migratedAppReaderClickHouse } from "./support/app-reader-clickhouse.support.ts";

/** The migrated schema, its reads as the app reader and its seed rows as the system. */
const openClickHouse = () =>
  migratedAppReaderClickHouse({
    suite: "evaluation-tables-reader",
    indexes: [...EVALUATION_ID_INDEXES, ...EVALUATION_SECOND_ID_INDEXES],
  });
const startMigratedClickHouse = async () => (await openClickHouse()).admin;

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

/** Main's meter read: the raw `_size_bytes` sum over one tenant's rows in `evaluation_runs`. */
async function rawStoredBytes(tenantId: string): Promise<number> {
  const client = await startMigratedClickHouse();
  const result = await client.query({
    query:
      "SELECT sum(_size_bytes) AS total FROM evaluation_runs WHERE TenantId = {tenantId:String}",
    query_params: { tenantId },
    format: "JSONEachRow",
  });
  const [row] = (await result.json()) as { total: string }[];
  return Number(row?.total ?? 0);
}

describe("evaluation's stored bytes against the migrated schema", () => {
  const tag = randomUUID();
  const ours = `${tag}-ours`;
  const theirs = `${tag}-theirs`;

  beforeAll(async () => {
    const run = (tenantId: string, evaluationId: string) => ({
      ProjectionId: `${tenantId}-${evaluationId}`,
      TenantId: tenantId,
      EvaluationId: evaluationId,
      Version: "v1",
      EvaluatorId: "evaluator_1",
      EvaluatorType: "native",
      TraceId: "trace_1",
      Status: "processed",
    });
    const client = await startMigratedClickHouse();
    await client.insert({
      table: "evaluation_runs",
      values: [run(ours, "evaluation_1"), run(ours, "evaluation_2"), run(theirs, "evaluation_1")],
      format: "JSONEachRow",
    });
  }, 180_000);

  afterAll(async () => {
    const client = await startMigratedClickHouse();
    await client.command({
      query: "ALTER TABLE evaluation_runs DELETE WHERE TenantId IN ({tenants:Array(String)})",
      query_params: { tenants: [ours, theirs] },
    });
  });

  /** @scenario "Evaluation's stored bytes count only this project's rows" */
  it("sums this project's `_size_bytes` as main's raw read does, without the other tenant's", async () => {
    const bytes = await EvaluationRunClickHouseReadRepository.create({
      resolveQueryClient: async () => (await openClickHouse()).client,
    }).getStoredBytes({ tenantId: ours });

    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBe(await rawStoredBytes(ours));
    expect(await rawStoredBytes(theirs)).toBeGreaterThan(0);
  });
});

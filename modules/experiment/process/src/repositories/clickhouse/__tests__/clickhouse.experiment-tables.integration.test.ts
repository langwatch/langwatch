/** @vitest-environment node */

/**
 * ADR-202, "Tables are typed descriptors": every column experiment's descriptors declare exists
 * on the migrated schema with the type it is declared as, so a descriptor cannot drift from goose.
 */
import { randomUUID } from "node:crypto";

import type { ClickHouseTableFacts } from "@langwatch/clickhouse-client/builder";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type MigratedClickHouse,
  deleteMigratedTenantRows,
  startMigratedClickHouse,
} from "../../../__tests__/migrated-clickhouse.harness.ts";
import { dspySteps } from "../clickhouse.dspy-steps.table.ts";
import { experimentRunItems } from "../clickhouse.experiment-run-items.table.ts";
import { ClickHouseExperimentRunRepository } from "../clickhouse.experiment-run.repository.ts";
import { experimentRuns } from "../clickhouse.experiment-runs.table.ts";
import { ClickHouseExperimentSession } from "../clickhouse.experiment-session.store.ts";

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
    migrated = await startMigratedClickHouse({ suite: "tables" });
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
          // `_retention_days` is retention plumbing (ADR-024); `_size_bytes` the meter reads.
          .filter((each) => each.name === "_size_bytes" || !each.name.startsWith("_"))
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

const METERED_TABLES = ["experiment_runs", "experiment_run_items", "dspy_steps"] as const;

describe("experiment's stored bytes against the migrated schema", () => {
  const tag = randomUUID();
  const ours = `${tag}-ours`;
  const theirs = `${tag}-theirs`;
  let migrated: MigratedClickHouse;

  /** Main's meter read: the raw `_size_bytes` sum over one tenant's rows in each metered table. */
  async function rawStoredBytes(tenantId: string): Promise<number> {
    let total = 0;
    for (const table of METERED_TABLES) {
      const result = await migrated.client.query({
        query: `SELECT sum(_size_bytes) AS total FROM ${table} WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId },
        format: "JSONEachRow",
      });
      const [row] = (await result.json()) as { total: string }[];
      total += Number(row?.total ?? 0);
    }
    return total;
  }

  beforeAll(async () => {
    migrated = await startMigratedClickHouse({ suite: "tables" });
    for (const tenantId of [ours, theirs]) {
      for (const table of METERED_TABLES) {
        await migrated.client.insert({
          table,
          values: [
            {
              Id: `${tenantId}-step`,
              ProjectionId: `${tenantId}-${table}`,
              TenantId: tenantId,
              RunId: "run_1",
              ExperimentId: "experiment_1",
              StepIndex: "0",
            },
          ],
          format: "JSONEachRow",
          clickhouse_settings: { input_format_skip_unknown_fields: 1 },
        });
      }
    }
  }, 240_000);

  afterAll(async () => {
    for (const tenantId of [ours, theirs]) {
      await deleteMigratedTenantRows({ client: migrated.client, tenantId, tables: METERED_TABLES });
    }
  });

  /** @scenario "Experiment's stored bytes count only this project's rows" */
  it("sums this project's `_size_bytes` over its three tables as main's raw read does", async () => {
    const bytes = await ClickHouseExperimentRunRepository.create({
      workflowVersions: { findByIds: async () => ({}) },
      resolveClient: ClickHouseExperimentSession.resolverOver(migrated.reading),
      telemetry: {
        trace: async <T>(_input: unknown, operation: () => Promise<T>) => operation(),
        warnOldRuns: () => {},
        error: () => {},
        warn: () => {},
      },
    }).getStoredBytes({ projectId: ours });

    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBe(await rawStoredBytes(ours));
    expect(await rawStoredBytes(theirs)).toBeGreaterThan(0);
  });
});

import { readFile } from "node:fs/promises";
import { createClient } from "@clickhouse/client";
import { describe, expect, it } from "vitest";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import {
  ClickHouseInstantEvalRunProjectionStore,
  stateFromRow,
} from "../instant-eval-run.projection-store";
import { ClickHouseInstantEvalRunRepository } from "../instant-eval-run.repository";
import { ClickHouseInstantEvalRunInterruptionsRepository } from "../instant-eval-run-interruptions.repository";

// Explicit opt-in local-only test. A unique database is never shared or reset.
const url = process.env.LANGWATCH_INTERRUPTION_TEST_CLICKHOUSE_URL;
describe.skipIf(!url)("Instant Eval interruption storage", () => {
  /** @scenario Interruption storage deduplicates receipts and isolates projects */
  it("persists deduplicated tenant-scoped evidence independently of late run writes", async () => {
    const parsed = new URL(url!);
    if (!["127.0.0.1", "localhost"].includes(parsed.hostname))
      throw new Error("Local ClickHouse only");
    const database = `langwatch8299_${Date.now()}_${process.pid}`;
    const admin = createClient({ url: url! });
    await admin.command({ query: `CREATE DATABASE ${database}` });
    const client = createClient({ url: url!, database });
    try {
      for (const file of [
        "00098_create_instant_eval_runs.sql",
        "00101_create_instant_eval_run_interruptions.sql",
      ]) {
        const migration = await readFile(
          `src/server/clickhouse/migrations/${file}`,
          "utf8",
        );
        const sql = migration
          .split("-- +goose Down")[0]!
          .match(/CREATE TABLE[\s\S]*?SETTINGS[^;]*;/)![0]
          .replaceAll("${CLICKHOUSE_DATABASE}", database)
          .replaceAll(
            "${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}",
            "ReplacingMergeTree(",
          )
          .replaceAll(
            "${CLICKHOUSE_ENGINE_MERGETREE:-MergeTree()}",
            "MergeTree()",
          )
          .replaceAll("${CLICKHOUSE_STORAGE_POLICY_SETTING}", "");
        await client.command({ query: sql });
      }
      const repository = new ClickHouseInstantEvalRunInterruptionsRepository(
        async () => client,
      );
      const receipt = {
        projectId: "project-1",
        runId: "run-1",
        componentType: "command",
        componentName: "recordPageJudged",
        operationKey: "page:1",
        observedAtMs: 100,
      } as const;
      await repository.record([
        receipt,
        receipt,
        { ...receipt, projectId: "project-2", componentName: "recordFinished" },
        {
          ...receipt,
          componentType: "projection",
          componentName: "instantEvalRun",
          operationKey: "event-1",
          observedAtMs: 200,
        },
      ]);
      const runs = new ClickHouseInstantEvalRunRepository({
        resolveClient: async () => client,
      });
      const row = await runs.create({
        id: "run-1",
        projectId: "project-1",
        name: null,
        sql: "local fixture",
        parameters: {},
        questions: [],
        plan: [],
        rowLimit: 100,
      });
      await new ClickHouseInstantEvalRunProjectionStore(runs).store(
        {
          state: stateFromRow({
            ...row,
            status: "FINISHED",
            progress: 100,
            finishedAt: new Date(),
          }),
          cursor: { eventId: "late-finished-event", acceptedAt: Date.now() },
          occurredAt: Date.now(),
          createdAt: row.createdAt.getTime(),
          updatedAt: Date.now(),
          version: "2026-09-18",
        },
        { tenantId: createTenantId("project-1"), aggregateId: "run-1" },
      );
      expect(
        await runs.findById({ projectId: "project-1", runId: "run-1" }),
      ).toMatchObject({ status: "FINISHED", progress: 100 });
      expect(
        await repository.blocksForRuns({
          projectId: "project-1",
          runIds: ["run-1"],
        }),
      ).toEqual({
        "run-1": {
          code: "instant_eval_processing_disabled",
          observedAtMs: 100,
          stages: [
            { componentType: "command", componentName: "recordPageJudged" },
            { componentType: "projection", componentName: "instantEvalRun" },
          ],
        },
      });
      expect(
        await repository.blocksForRuns({
          projectId: "project-2",
          runIds: ["run-1"],
        }),
      ).toEqual({
        "run-1": {
          code: "instant_eval_processing_disabled",
          observedAtMs: 100,
          stages: [
            { componentType: "command", componentName: "recordFinished" },
          ],
        },
      });
      expect(
        await repository.blocksForRuns({
          projectId: "project-1",
          runIds: ["missing"],
        }),
      ).toEqual({});
    } finally {
      // Only this test's newly-created database is removed.
      await client.close();
      await admin.command({ query: `DROP DATABASE ${database}` });
      await admin.close();
    }
  });
});

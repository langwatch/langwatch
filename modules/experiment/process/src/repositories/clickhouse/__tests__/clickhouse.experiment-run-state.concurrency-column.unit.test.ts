/**
 * @vitest-environment node
 * @see modules/experiment/specs/experiment-run-recorded-settings.feature
 */
import type { ReaderReadStatement } from "@langwatch/clickhouse-client/builder";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { makeExperimentRunKey } from "../../../rules/experiment-run-key.rules.ts";
import { ClickHouseExperimentRunStateRepository } from "../clickhouse.experiment-run-state.repository.ts";

const BEFORE_00125 = [{ table: "experiment_runs", name: "RunId" }];
const AFTER_00125 = [...BEFORE_00125, { table: "experiment_runs", name: "Concurrency" }];

async function readStateOver(columnList: readonly { table: string; name: string }[]) {
  const statements: ReaderReadStatement[] = [];
  const repository = ClickHouseExperimentRunStateRepository.create({
    clickhouse: {
      resolveClient: async () =>
        ({
          insert: async () => undefined,
          read: async ({ statement }: { statement: ReaderReadStatement }) => {
            statements.push(statement);
            return { rows: [] };
          },
          holds:
            async ({ table }: { table: string }) =>
            (name: string) =>
              columnList.some((each) => each.table === table && each.name === name),
        }) as never,
    },
    defaultRetentionDays: () => 30,
  });
  await repository.findProjection(makeExperimentRunKey("experiment_1", "run_1"), {
    tenantId: createTenantId("project_1"),
  });
  const [statement] = statements;
  expect(statement).toMatchObject({ identity: "reader", kind: "tenant", tenantId: "project_1" });
  expect(statement?.settings).toMatchObject({ SQL_langwatch_tenant_ids: "project_1" });
  return statement?.sql ?? "";
}

describe("ClickHouseExperimentRunStateRepository concurrency column", () => {
  describe("given the target has no concurrency column yet", () => {
    /** @scenario "A run's state read before the concurrency column exists answers no concurrency" */
    it("selects a NULL concurrency in place of the column", async () => {
      const statement = await readStateOver(BEFORE_00125);

      expect(statement).toMatch(/CAST\(NULL AS Nullable\(UInt16\)\) AS `?RecordedConcurrency\b/);
      expect(statement).not.toMatch(/\bConcurrency\b/);
    });
  });

  describe("given the target has the concurrency column", () => {
    /** @scenario "A run's state read once the concurrency column exists answers the stored concurrency" */
    it("selects the stored column", async () => {
      const statement = await readStateOver(AFTER_00125);

      expect(statement).toMatch(/\bConcurrency`? AS `?RecordedConcurrency\b/);
    });
  });
});

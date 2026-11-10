/**
 * @vitest-environment node
 * @see modules/experiment/specs/experiment-run-recorded-settings.feature
 */
import { ClickHouseColumns } from "@langwatch/clickhouse-client";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { makeExperimentRunKey } from "../../../rules/experiment-run-key.rules.ts";
import { ClickHouseExperimentRunStateRepository } from "../clickhouse.experiment-run-state.repository.ts";

const BEFORE_00125 = [{ table: "experiment_runs", name: "RunId" }];
const AFTER_00125 = [...BEFORE_00125, { table: "experiment_runs", name: "Concurrency" }];

async function readStateOver(columnList: readonly { table: string; name: string }[]) {
  const statements: string[] = [];
  const columns = ClickHouseColumns.over({ read: async () => columnList });
  const repository = ClickHouseExperimentRunStateRepository.create({
    clickhouse: {
      resolveClient: async () => ({
        insert: async () => undefined,
        query: async ({ query }) => {
          statements.push(query);
          return { json: async () => [] };
        },
        select: (input) => columns.select(input),
      }),
    },
    defaultRetentionDays: () => 30,
  });
  await repository.findProjection(makeExperimentRunKey("experiment_1", "run_1"), {
    tenantId: createTenantId("project_1"),
  });
  return statements[0] ?? "";
}

describe("ClickHouseExperimentRunStateRepository concurrency column", () => {
  describe("given the target has no concurrency column yet", () => {
    /** @scenario "A run's state read before the concurrency column exists answers no concurrency" */
    it("selects a NULL concurrency under the column name", async () => {
      const statement = await readStateOver(BEFORE_00125);

      expect(statement).toContain("CAST(NULL AS Nullable(UInt16)) AS `Concurrency`");
    });
  });

  describe("given the target has the concurrency column", () => {
    /** @scenario "A run's state read once the concurrency column exists answers the stored concurrency" */
    it("selects the stored column", async () => {
      const statement = await readStateOver(AFTER_00125);

      expect(statement).toContain("t.`Concurrency` AS `Concurrency`");
    });
  });
});

/**
 * @vitest-environment node
 * @see modules/experiment/specs/experiment-run-results-completeness.feature
 */
import { ClickHouseColumns } from "@langwatch/clickhouse-client";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { makeExperimentRunKey } from "../../../rules/experiment-run-key.rules.ts";
import { ClickHouseExperimentRunStateRepository } from "../clickhouse.experiment-run-state.repository.ts";

const BEFORE_00105 = [{ table: "experiment_runs", name: "RunId" }];
const AFTER_00105 = [
  ...BEFORE_00105,
  { table: "experiment_runs", name: "ExpectedTargetResults" },
  { table: "experiment_runs", name: "ExpectedEvaluatorResults" },
];

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

describe("ClickHouseExperimentRunStateRepository expected-results columns", () => {
  describe("given the target has no expected-results columns yet", () => {
    /** @scenario "A run's state read before the expected-results columns exist answers no counts" */
    it("selects NULL counts under the column names", async () => {
      const statement = await readStateOver(BEFORE_00105);

      expect(statement).toContain("CAST(NULL AS Nullable(UInt32)) AS `ExpectedTargetResults`");
      expect(statement).toContain("CAST(NULL AS Nullable(UInt32)) AS `ExpectedEvaluatorResults`");
    });
  });

  describe("given the target has the expected-results columns", () => {
    /** @scenario "A run's state read once the expected-results columns exist answers the stored counts" */
    it("selects the stored columns", async () => {
      const statement = await readStateOver(AFTER_00105);

      expect(statement).toContain("t.`ExpectedTargetResults` AS `ExpectedTargetResults`");
      expect(statement).toContain("t.`ExpectedEvaluatorResults` AS `ExpectedEvaluatorResults`");
    });
  });
});

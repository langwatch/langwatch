/**
 * @vitest-environment node
 * @see modules/experiment/specs/experiment-run-results-completeness.feature
 */
import type { ReaderReadStatement } from "@langwatch/clickhouse-client/builder";
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

describe("ClickHouseExperimentRunStateRepository expected-results columns", () => {
  describe("given the target has no expected-results columns yet", () => {
    /** @scenario "A run's state read before the expected-results columns exist answers no counts" */
    it("selects NULL counts in place of the columns", async () => {
      const statement = await readStateOver(BEFORE_00105);

      expect(statement).toMatch(/CAST\(NULL AS Nullable\(UInt32\)\) AS `?RecordedTargetResults\b/);
      expect(statement).toMatch(
        /CAST\(NULL AS Nullable\(UInt32\)\) AS `?RecordedEvaluatorResults\b/,
      );
      expect(statement).not.toContain("ExpectedTargetResults");
    });
  });

  describe("given the target has the expected-results columns", () => {
    /** @scenario "A run's state read once the expected-results columns exist answers the stored counts" */
    it("selects the stored columns", async () => {
      const statement = await readStateOver(AFTER_00105);

      expect(statement).toMatch(/ExpectedTargetResults`? AS `?RecordedTargetResults\b/);
      expect(statement).toMatch(/ExpectedEvaluatorResults`? AS `?RecordedEvaluatorResults\b/);
    });
  });
});

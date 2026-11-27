/**
 * @see modules/evaluation/specs/evaluator-platform-usage.feature
 * The platform-wide type usage read walks the shared ClickHouse and every private one.
 */
import { describe, expect, it } from "vitest";

import type {
  EvaluationClickHouseClient,
  EvaluationClickHouseQuery,
} from "../clickhouse.evaluation-session.store.ts";
import { ClickHouseMonitorPerformanceRepository } from "../monitor-performance.repository.ts";

const SHARED = "shared";

/** One placement's answer per routed organization; the shared one answers under `shared`. */
function placementsAnswering(answers: Record<string, unknown[]>) {
  const asked: string[] = [];
  const client: EvaluationClickHouseClient = {
    insert: () => Promise.reject(new Error("the usage read never inserts")),
    query: async (input: EvaluationClickHouseQuery) => {
      const placement = input.organizationId ?? SHARED;
      asked.push(placement);
      return { json: async <T>() => (answers[placement] ?? []) as T[] };
    },
  };
  return { asked, resolveClient: () => Promise.resolve(client) };
}

describe("ClickHouseMonitorPerformanceRepository type usage", () => {
  describe("when an organization keeps its runs on a private ClickHouse", () => {
    it("reads every placement and adds each type's counts up", async () => {
      const placements = placementsAnswering({
        [SHARED]: [
          {
            EvaluatorType: "langevals/llm_boolean",
            Projects: "3",
            Runs: "10",
            Errors: "2",
            Skipped: "1",
            ErrorCodes: [["timeout"], ["2"]],
          },
        ],
        org_acme: [
          {
            EvaluatorType: "langevals/llm_boolean",
            Projects: "1",
            Runs: "5",
            Errors: "1",
            Skipped: "0",
            ErrorCodes: [["timeout"], ["1"]],
          },
          {
            EvaluatorType: "presidio/pii_detection",
            Projects: "1",
            Runs: "20",
            Errors: "0",
            Skipped: "0",
            ErrorCodes: [[], []],
          },
        ],
      });
      const repository = ClickHouseMonitorPerformanceRepository.create({
        resolveClient: placements.resolveClient,
        privateOrganizations: () => ["org_acme"],
      });

      const rows = await repository.findTypeUsageRows({ since: 0, until: 1_000, limit: 10 });

      expect(placements.asked.toSorted()).toEqual(["org_acme", SHARED]);
      expect(rows).toEqual([
        {
          evaluatorType: "presidio/pii_detection",
          projects: 1,
          runs: 20,
          errors: 0,
          skipped: 0,
          errorsByCode: {},
        },
        {
          evaluatorType: "langevals/llm_boolean",
          projects: 4,
          runs: 15,
          errors: 3,
          skipped: 1,
          errorsByCode: { timeout: 3 },
        },
      ]);
    });
  });
});

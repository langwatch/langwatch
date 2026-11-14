// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 * What every cost screen read asks the summary table for: the pulled lane, at the current shape.
 * The statement is pinned, not the rows; the rows are the store's. Spec:
 * specs/governance/governance-cost-screen.feature
 */
import type { ReaderReadStatement } from "@langwatch/clickhouse-client/builder";
import { describe, expect, it } from "vitest";

import { GOVERNANCE_COST_SOURCE } from "../../../features/cost/rules/governance-cost-rollup-cell.rules.ts";
import { GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST } from "../../governance-cost-rollup.repository.ts";
import { ClickHouseGovernanceCostRollupRepository } from "../clickhouse.governance-cost-rollup.repository.ts";

const WINDOW = { tenantId: "project-a", fromDay: "2026-09-01", toDay: "2026-09-30" };
const PULLED = { ...WINDOW, costSource: GOVERNANCE_COST_SOURCE.PULLED };

function repositoryOverRecorder() {
  const statements: ReaderReadStatement[] = [];
  const client = {
    read: async ({ statement }: { statement: ReaderReadStatement }) => {
      statements.push(statement);
      return { rows: [] };
    },
  };
  const repository = ClickHouseGovernanceCostRollupRepository.create(async () => client as never);
  return { repository, statements };
}

/** The values a statement binds `column = {…}` to, in the order its text names them. */
function boundTo(statement: ReaderReadStatement | undefined, column: string): unknown[] {
  const pattern = new RegExp(`\\b${column} = \\{(\\w+):String\\}`, "g");
  return [...(statement?.sql ?? "").matchAll(pattern)].map(
    ([, name]) => statement?.params[name ?? ""],
  );
}

/** Every read the billed total, the breakdowns and the day series are built from. */
const SCREEN_READS: {
  name: string;
  run: (repository: ClickHouseGovernanceCostRollupRepository) => Promise<unknown>;
}[] = [
  { name: "sumWindowByProvider", run: (r) => r.sumWindowByProvider(WINDOW) },
  { name: "sumWindowByCurrency", run: (r) => r.sumWindowByCurrency(PULLED) },
  { name: "sumWindowByModel", run: (r) => r.sumWindowByModel(WINDOW) },
  { name: "sumWindowBySpender", run: (r) => r.sumWindowBySpender(WINDOW) },
  { name: "sumDaysByProvider", run: (r) => r.sumDaysByProvider(WINDOW) },
  {
    name: "sumPeriodRecordsByProvider",
    run: (r) => r.sumPeriodRecordsByProvider({ ...WINDOW, provider: "openai" }),
  },
  { name: "sumDaysByLane", run: (r) => r.sumDaysByLane(PULLED) },
];

describe("ClickHouseGovernanceCostRollupRepository screen reads", () => {
  describe("when the billed total, the breakdowns and the day series are read", () => {
    /** @scenario Gateway rows left in the rollup are counted nowhere */
    it.each(SCREEN_READS)("$name counts pulled rows only", async (read) => {
      const { repository, statements } = repositoryOverRecorder();

      await read.run(repository);

      expect(statements).toHaveLength(1);
      expect(boundTo(statements[0], "CostSource")).toEqual([GOVERNANCE_COST_SOURCE.PULLED]);
    });
  });

  describe("when the summary table holds rows written by an older version of the summary", () => {
    /** @scenario Rows written by an older summary shape are not counted */
    it.each(SCREEN_READS)("$name reads only the current shape's rows", async (read) => {
      const { repository, statements } = repositoryOverRecorder();

      await read.run(repository);

      expect(boundTo(statements[0], "Version")).toEqual([
        GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
      ]);
    });
  });
});

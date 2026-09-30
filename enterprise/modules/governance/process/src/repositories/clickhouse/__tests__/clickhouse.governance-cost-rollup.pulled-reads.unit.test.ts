// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 * What every cost screen read asks the summary table for: the pulled lane, at the current shape.
 * The statement is pinned, not the rows; the rows are the store's. Spec:
 * specs/governance/governance-cost-screen.feature
 */
import type { QueryRequest, QueryResult } from "@langwatch/clickhouse-client";
import { ClickHouseQueryClient, TenantGuard } from "@langwatch/clickhouse-client";
import { describe, expect, it } from "vitest";

import {
  GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
  GOVERNANCE_COST_SOURCE,
} from "../../governance-cost-rollup.repository.ts";
import { memberClickHouseResolver } from "../clickhouse.governance-clickhouse.repositories.ts";
import { ClickHouseGovernanceCostRollupRepository } from "../clickhouse.governance-cost-rollup.repository.ts";

const WINDOW = { tenantId: "project-a", fromDay: "2026-09-01", toDay: "2026-09-30" };
const PULLED = { ...WINDOW, costSource: GOVERNANCE_COST_SOURCE.PULLED };

function repositoryOverRecorder() {
  const executed: QueryRequest[] = [];
  const clickhouse = new ClickHouseQueryClient({
    tenantGuard: new TenantGuard(),
    driver: {
      execute: async <Row>(request: QueryRequest): Promise<QueryResult<Row>> => {
        executed.push(request);
        return { rows: [] };
      },
      insert: async () => undefined,
      command: async () => undefined,
    },
  });
  const repository = ClickHouseGovernanceCostRollupRepository.create(
    memberClickHouseResolver(clickhouse),
  );
  return { repository, executed };
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
      const { repository, executed } = repositoryOverRecorder();

      await read.run(repository);

      const [request] = executed;
      expect(request?.params?.costsource).toBe(GOVERNANCE_COST_SOURCE.PULLED);
      expect(request?.sql).toContain("CostSource = {costsource:String}");
    });
  });

  describe("when the summary table holds rows written by an older version of the summary", () => {
    /** @scenario Rows written by an older summary shape are not counted */
    it.each(SCREEN_READS)("$name reads only the current shape's rows", async (read) => {
      const { repository, executed } = repositoryOverRecorder();

      await read.run(repository);

      const [request] = executed;
      expect(request?.params?.version).toBe(GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST);
      expect(request?.sql).toContain("Version = {version:String}");
    });
  });
});

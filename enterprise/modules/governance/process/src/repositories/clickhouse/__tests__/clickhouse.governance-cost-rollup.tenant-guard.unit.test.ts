// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 * Each cost summary read runs through the real tenant guard, so a statement it would refuse live
 * fails here. Spec: specs/governance/governance-cost-rollup.feature
 */
import type { QueryRequest, QueryResult } from "@langwatch/clickhouse-client";
import { ClickHouseQueryClient, TenantGuard } from "@langwatch/clickhouse-client";
import { describe, expect, it } from "vitest";

import { memberClickHouseResolver } from "../clickhouse.governance-clickhouse.repositories.ts";
import { ClickHouseGovernanceCostRollupRepository } from "../clickhouse.governance-cost-rollup.repository.ts";

const WINDOW = { tenantId: "project-a", fromDay: "2026-09-01", toDay: "2026-09-30" };

function guardedRepository() {
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

const READS: {
  name: string;
  run: (repository: ClickHouseGovernanceCostRollupRepository) => Promise<unknown>;
}[] = [
  { name: "sumDaysByProvider", run: (r) => r.sumDaysByProvider(WINDOW) },
  {
    name: "sumPeriodRecordsByProvider",
    run: (r) => r.sumPeriodRecordsByProvider({ ...WINDOW, provider: "openai" }),
  },
  { name: "sumWindowBySpender", run: (r) => r.sumWindowBySpender(WINDOW) },
  { name: "sumWindowByModel", run: (r) => r.sumWindowByModel(WINDOW) },
  { name: "sumDaysByLane", run: (r) => r.sumDaysByLane(WINDOW) },
  {
    name: "sumDaysByLane for one lane",
    run: (r) => r.sumDaysByLane({ ...WINDOW, costSource: "pulled" }),
  },
  { name: "sumWindowByProvider", run: (r) => r.sumWindowByProvider(WINDOW) },
  {
    name: "sumWindowByCurrency",
    run: (r) => r.sumWindowByCurrency({ ...WINDOW, costSource: "pulled" }),
  },
  {
    name: "hasRowsForSource",
    run: (r) =>
      r.hasRowsForSource({ ...WINDOW, costSource: "pulled", ingestionSourceId: "source-1" }),
  },
];

describe("ClickHouseGovernanceCostRollupRepository under the tenant guard", () => {
  describe("when each cost summary read runs through the real guard", () => {
    /** @scenario "Every cost summary read passes the tenant guard" */
    it.each(READS)("$name is accepted and scoped to the one tenant it names", async (read) => {
      const { repository, executed } = guardedRepository();

      await read.run(repository);

      expect(executed).toHaveLength(1);
      expect(executed[0]?.tenantId).toBe("project-a");
      expect(executed[0]?.params?.tenantid).toBe("project-a");
      expect(executed[0]?.unscoped).toBeUndefined();
    });
  });
});

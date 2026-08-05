/**
 * Guard-clause coverage for the ADR-034 read repositories.
 *
 * `route-table.integration.test.ts` drives ClickHouse directly rather than
 * through these repositories, so the two pre-flight throws — missing tenantId,
 * and an unresolvable per-project client — had no coverage at all. Both are
 * pure logic and need nothing but a stubbed resolver.
 *
 * The tenantId guard is a multitenancy boundary: a repository that reached
 * ClickHouse with an empty tenant would emit a query whose
 * `TenantId = {tenantId:String}` predicate matches nothing (or, worse, whose
 * absence would be a cross-tenant read). It must throw before building SQL.
 *
 * All four destinations share one implementation, so the guards are asserted
 * against every factory — a future fifth destination that forgets to route
 * through the shared class fails here.
 */

import { describe, expect, it, vi } from "vitest";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { AnalyticsClientUnavailableError } from "../errors";
import {
  type AnalyticsTimeseriesReadRepository,
  createEvalRollupReadRepo,
  createEvalSlimReadRepo,
  createTraceRollupReadRepo,
  createTraceSlimReadRepo,
  type RunTimeseriesParams,
} from "../repositories/analyticsTimeseriesRead.repository";

const DESTINATIONS: {
  name: string;
  create: (
    resolve: ClickHouseClientResolver,
  ) => AnalyticsTimeseriesReadRepository;
}[] = [
  { name: "trace-analytics-rollup", create: createTraceRollupReadRepo },
  { name: "trace-analytics", create: createTraceSlimReadRepo },
  { name: "evaluation-analytics-rollup", create: createEvalRollupReadRepo },
  { name: "evaluation-analytics", create: createEvalSlimReadRepo },
];

function params(overrides: Partial<RunTimeseriesParams> = {}) {
  return {
    tenantId: "project-1",
    series: [{ metric: "performance.total_cost", aggregation: "sum" }],
    builderInput: {
      projectId: "project-1",
      startDate: new Date("2026-06-15T00:00:00.000Z"),
      endDate: new Date("2026-06-16T00:00:00.000Z"),
      previousPeriodStartDate: new Date("2026-06-14T00:00:00.000Z"),
      series: [{ metric: "performance.total_cost", aggregation: "sum" }],
      timeScale: 60,
    },
    ...overrides,
  } as unknown as RunTimeseriesParams;
}

describe("ADR-034 read repositories", () => {
  for (const { name, create } of DESTINATIONS) {
    describe(`${name} read repository`, () => {
      describe("given an empty tenantId", () => {
        it("throws before resolving a client", async () => {
          const resolveClient = vi.fn();
          const repo = create(resolveClient);

          await expect(repo.run(params({ tenantId: "" }))).rejects.toThrow(
            /tenantId is required/,
          );
          expect(resolveClient).not.toHaveBeenCalled();
        });
      });

      describe("when no ClickHouse client resolves for the project", () => {
        it("throws AnalyticsClientUnavailableError", async () => {
          const repo = create(vi.fn().mockResolvedValue(null));

          await expect(repo.run(params())).rejects.toBeInstanceOf(
            AnalyticsClientUnavailableError,
          );
        });
      });
    });
  }
});

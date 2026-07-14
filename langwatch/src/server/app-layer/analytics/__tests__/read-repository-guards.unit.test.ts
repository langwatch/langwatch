/**
 * Guard-clause coverage for the two ADR-034 read repositories.
 *
 * `route-table.integration.test.ts` drives ClickHouse directly rather than
 * through these classes, so the two pre-flight throws — missing tenantId, and
 * an unresolvable per-project client — had no coverage at all. Both are pure
 * logic and need nothing but a stubbed resolver.
 *
 * The tenantId guard is a multitenancy boundary: a repository that reached
 * ClickHouse with an empty tenant would emit a query whose
 * `TenantId = {tenantId:String}` predicate matches nothing (or, worse, whose
 * absence would be a cross-tenant read). It must throw before building SQL.
 */

import { describe, expect, it, vi } from "vitest";
import { AnalyticsClientUnavailableError } from "../errors";
import { TraceAnalyticsRollupClickHouseReadRepository } from "../repositories/trace-analytics-rollup.clickhouse.repository";
import {
  type RunTimeseriesParams,
  TraceAnalyticsClickHouseReadRepository,
} from "../repositories/trace-analytics.clickhouse.repository";

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
  describe("TraceAnalyticsRollupClickHouseReadRepository.runRollupTimeseries", () => {
    describe("given an empty tenantId", () => {
      it("throws before resolving a client", async () => {
        const resolveClient = vi.fn();
        const repo = new TraceAnalyticsRollupClickHouseReadRepository(
          resolveClient,
        );
        await expect(
          repo.runRollupTimeseries(params({ tenantId: "" })),
        ).rejects.toThrow(/tenantId is required/);
        expect(resolveClient).not.toHaveBeenCalled();
      });
    });

    describe("when no ClickHouse client resolves for the project", () => {
      it("throws AnalyticsClientUnavailableError", async () => {
        const repo = new TraceAnalyticsRollupClickHouseReadRepository(
          vi.fn().mockResolvedValue(null),
        );
        await expect(repo.runRollupTimeseries(params())).rejects.toBeInstanceOf(
          AnalyticsClientUnavailableError,
        );
      });
    });
  });

  describe("TraceAnalyticsClickHouseReadRepository.runSlimTimeseries", () => {
    describe("given an empty tenantId", () => {
      it("throws before resolving a client", async () => {
        const resolveClient = vi.fn();
        const repo = new TraceAnalyticsClickHouseReadRepository(resolveClient);
        await expect(
          repo.runSlimTimeseries(params({ tenantId: "" })),
        ).rejects.toThrow(/tenantId is required/);
        expect(resolveClient).not.toHaveBeenCalled();
      });
    });

    describe("when no ClickHouse client resolves for the project", () => {
      it("throws AnalyticsClientUnavailableError", async () => {
        const repo = new TraceAnalyticsClickHouseReadRepository(
          vi.fn().mockResolvedValue(null),
        );
        await expect(repo.runSlimTimeseries(params())).rejects.toBeInstanceOf(
          AnalyticsClientUnavailableError,
        );
      });
    });
  });
});

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
import { ANALYTICS_CLICKHOUSE_SETTINGS } from "~/server/analytics/clickhouse/clickhouse-analytics.service";
import type {
  ClickHouseClientResolver,
  TenantClickHouseClient,
  TenantQuery,
} from "~/server/app-layer/clients/clickhouse/tenant-client";
import { AnalyticsClientUnavailableError } from "../errors";
import {
  type AnalyticsTimeseriesReadRepository,
  createEvalRollupReadRepo,
  createEvalSlimReadRepo,
  createTraceRollupReadRepo,
  createTraceSlimReadRepo,
  type RunTimeseriesParams,
} from "../repositories/analyticsTimeseriesRead.repository";

/**
 * `metric` is the one each destination's builder accepts — the trace tables
 * serve trace metrics and the evaluation tables serve evaluation metrics, and
 * every builder refuses a metric the router should never have sent it. The
 * guards below never get far enough to build SQL, but the success-path case
 * does, so it has to ask each destination for something it can answer.
 */
const DESTINATIONS: {
  name: string;
  table: string;
  metric: string;
  create: (
    resolve: ClickHouseClientResolver,
  ) => AnalyticsTimeseriesReadRepository;
}[] = [
  {
    name: "trace-analytics-rollup",
    table: "trace_analytics_rollup",
    metric: "performance.total_cost",
    create: createTraceRollupReadRepo,
  },
  {
    name: "trace-analytics",
    table: "trace_analytics",
    metric: "performance.total_cost",
    create: createTraceSlimReadRepo,
  },
  {
    name: "evaluation-analytics-rollup",
    table: "evaluation_analytics_rollup",
    metric: "evaluations.evaluation_score",
    create: createEvalRollupReadRepo,
  },
  {
    name: "evaluation-analytics",
    table: "evaluation_analytics",
    metric: "evaluations.evaluation_score",
    create: createEvalSlimReadRepo,
  },
];

/**
 * A client that records what each read sent and answers with no rows. The
 * repositories are asserted on the request they issued, not on a decoded
 * result — the row shape is the parser's contract, covered in
 * `timeseries-row-parser.unit.test.ts`.
 */
function capturingClient(): {
  resolve: ClickHouseClientResolver;
  requests: TenantQuery[];
} {
  const requests: TenantQuery[] = [];
  const client = {
    tenantId: "project-1",
    query: async (request: TenantQuery) => {
      requests.push(request);
      return [];
    },
    insert: vi.fn(),
    queryWindowed: vi.fn(),
  } as unknown as TenantClickHouseClient;

  return { resolve: async () => client, requests };
}

function params(
  overrides: Partial<RunTimeseriesParams> = {},
  metric = "performance.total_cost",
) {
  const series = [{ metric, aggregation: "sum" }];
  return {
    tenantId: "project-1",
    series,
    builderInput: {
      projectId: "project-1",
      startDate: new Date("2026-06-15T00:00:00.000Z"),
      endDate: new Date("2026-06-16T00:00:00.000Z"),
      previousPeriodStartDate: new Date("2026-06-14T00:00:00.000Z"),
      series,
      timeScale: 60,
    },
    ...overrides,
  } as unknown as RunTimeseriesParams;
}

describe("ADR-034 read repositories", () => {
  for (const { name, table, metric, create } of DESTINATIONS) {
    describe(`${name} read repository`, () => {
      describe("when the read reaches the client", () => {
        it("labels the read with its own table and carries the analytics settings", async () => {
          const { resolve, requests } = capturingClient();

          await create(resolve).run(params({}, metric));

          expect(requests).toHaveLength(1);
          expect(requests[0]).toMatchObject({
            table,
            settings: ANALYTICS_CLICKHOUSE_SETTINGS,
          });
        });
      });

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

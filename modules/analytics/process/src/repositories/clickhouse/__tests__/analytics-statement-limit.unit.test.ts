/**
 * The analytics panel reads (timeseries and top documents) run through the per-project gate, so a
 * dashboard load never sends every panel's statement to ClickHouse at once.
 * @see specs/analytics/clickhouse-memory-safety.feature
 */
import type { AnalyticsTimeseriesInput } from "@langwatch/analytics-contract";
import { HandledError } from "@langwatch/handled-error";
import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import { Temporal } from "@langwatch/time";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AnalyticsTimeseriesQuery } from "../../analytics.repository.ts";
import type { EvaluationAnalyticsClickHouseClient } from "../clickhouse.analytics-persistence.repository.ts";
import {
  ClickHouseAnalyticsStatementLimitRepository,
  TENANT_ANALYTICS_MAX_QUEUED,
  TENANT_ANALYTICS_METRICS_INSTANCE,
  TENANT_ANALYTICS_WAIT_TIMEOUT_MS,
} from "../clickhouse.analytics-statement-limit.repository.ts";
import { ClickHouseAnalyticsRepository } from "../clickhouse.analytics.repository.ts";

vi.mock("../clickhouse.aggregation-builder.mapper.ts", () => ({
  buildTimeseriesQuery: vi.fn().mockReturnValue({ sql: "SELECT 1", params: {} }),
  buildFeedbacksQuery: vi.fn(),
  buildTopDocumentsQuery: vi.fn().mockReturnValue({ sql: "SELECT 2", params: {} }),
}));

/** A client whose statements stay open until the test drains them. */
function heldClient() {
  const pending: (() => void)[] = [];
  let open = 0;
  const query = vi.fn(async () => {
    open += 1;
    await new Promise<void>((resolve) => pending.push(resolve));
    return {
      json: async (): Promise<Record<string, unknown>[]> => {
        open -= 1;
        return [];
      },
    };
  });
  const client: EvaluationAnalyticsClickHouseClient = { insert: async () => undefined, query };
  return {
    client,
    query,
    get open() {
      return open;
    },
    releaseOne: () => pending.shift()?.(),
    releaseAll: () => {
      for (const resolve of pending.splice(0)) resolve();
    },
  };
}

function timeseriesQuery(tenantId: string): AnalyticsTimeseriesQuery {
  const startDate = Temporal.Instant.from("2026-07-01T00:00:00.000Z");
  const input: AnalyticsTimeseriesInput = {
    projectId: tenantId,
    startDate: 1_782_864_000_000,
    endDate: 1_784_160_000_000,
    filters: {},
    series: [],
    timeScale: 1440,
    timeZone: "UTC",
  };
  return {
    table: "trace_summaries",
    tenantId,
    startDate,
    endDate: Temporal.Instant.from("2026-07-16T00:00:00.000Z"),
    previousPeriodStartDate: startDate,
    adjustedTimeScale: 1440,
    maxResultRows: undefined,
    input,
  };
}

const repositoryOver = (client: EvaluationAnalyticsClickHouseClient, maxConcurrent: number) =>
  ClickHouseAnalyticsRepository.create({
    resolveClient: async () => client,
    statementLimiter: ClickHouseAnalyticsStatementLimitRepository.create({ maxConcurrent }),
  });

const settle = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => {
  vi.useRealTimers();
});

describe("ClickHouseAnalyticsRepository under the tenant gate", () => {
  describe("when one project's dashboard fires more panel reads than the gate allows", () => {
    /** @scenario "A dashboard load runs a bounded number of panel queries at once" */
    it("sends only the gate's limit to ClickHouse and starts the next as one drains", async () => {
      const held = heldClient();
      const repository = repositoryOver(held.client, 2);
      const reads = [
        ...Array.from({ length: 4 }, () => repository.runTimeseries(timeseriesQuery("project-1"))),
        repository.findTopDocuments({
          projectId: "project-1",
          startDate: 0,
          endDate: 1,
          filters: {},
        }),
      ];
      await settle();
      expect(held.query).toHaveBeenCalledTimes(2);

      held.releaseOne();
      await settle();
      expect(held.query).toHaveBeenCalledTimes(3);
      expect(held.open).toBe(2);

      for (let i = 0; i < 5; i++) {
        held.releaseAll();
        await settle();
      }
      await Promise.all(reads);
      expect(held.query).toHaveBeenCalledTimes(5);
    });
  });

  describe("when another project reads while the first is queued", () => {
    it("reaches ClickHouse without waiting behind the first project", async () => {
      const held = heldClient();
      const repository = repositoryOver(held.client, 1);
      const first = [
        repository.runTimeseries(timeseriesQuery("project-1")),
        repository.runTimeseries(timeseriesQuery("project-1")),
      ];
      const other = repository.runTimeseries(timeseriesQuery("project-2"));
      await settle();

      expect(held.query).toHaveBeenCalledTimes(2);

      for (let i = 0; i < 3; i++) {
        held.releaseAll();
        await settle();
      }
      await Promise.all([...first, other]);
    });
  });

  describe("when a panel waits longer than the wait bound for its project's turn", () => {
    /** @scenario "A panel waiting too long for its tenant's turn fails as a transient overload" */
    it("fails with the transient clickhouse_overloaded error and never reaches ClickHouse", async () => {
      vi.useFakeTimers();
      const held = heldClient();
      const repository = repositoryOver(held.client, 1);
      const running = repository.runTimeseries(timeseriesQuery("project-1"));
      const waiting = repository.runTimeseries(timeseriesQuery("project-1")).catch((e) => e);
      await vi.advanceTimersByTimeAsync(0);
      expect(held.query).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(45_000);
      const error = await waiting;

      expect(HandledError.isHandled(error)).toBe(true);
      expect((error as HandledError).code).toBe("clickhouse_overloaded");
      expect(held.query).toHaveBeenCalledTimes(1);

      held.releaseAll();
      await running;
    });
  });
});

describe("ClickHouseAnalyticsStatementLimitRepository", () => {
  describe("when built", () => {
    it("bounds the queue at 64 and the wait at 45 seconds under the tenant-analytics label", () => {
      expect(TENANT_ANALYTICS_MAX_QUEUED).toBe(64);
      expect(TENANT_ANALYTICS_WAIT_TIMEOUT_MS).toBe(45_000);
      expect(TENANT_ANALYTICS_METRICS_INSTANCE).toBe("tenant-analytics");
    });
  });

  describe("when a project's wait queue is full", () => {
    it("refuses as clickhouse_overloaded and counts the refusal on its metrics", async () => {
      const metrics = createRecordingMeterProvider();
      metrics.install();
      try {
        const limiter = ClickHouseAnalyticsStatementLimitRepository.create({ maxConcurrent: 1 });
        const releases: (() => void)[] = [];
        const held = () =>
          limiter.run({
            tenantId: "project-1",
            task: () => new Promise<void>((resolve) => releases.push(resolve)),
          });
        const running = [held()];
        for (let i = 0; i < TENANT_ANALYTICS_MAX_QUEUED; i++) running.push(held());
        await settle();

        const error = await limiter
          .run({ tenantId: "project-1", task: async () => undefined })
          .catch((e: unknown) => e);
        expect(HandledError.isHandled(error)).toBe(true);
        expect((error as HandledError).code).toBe("clickhouse_overloaded");
        expect(
          metrics.valueOf("clickhouse_statements_shed_total", {
            instance: TENANT_ANALYTICS_METRICS_INSTANCE,
            operation: "query",
          }),
        ).toBe(1);

        await metrics.collect();
        expect(
          metrics.valuesOf("clickhouse_statements_in_flight", {
            instance: TENANT_ANALYTICS_METRICS_INSTANCE,
          }),
        ).toContain(1);

        while (releases.length > 0 || limiter.activeTenantCount() > 0) {
          for (const release of releases.splice(0)) release();
          await settle();
        }
        await Promise.all(running);
      } finally {
        metrics.uninstall();
      }
    });
  });
});

/**
 * @vitest-environment node
 *
 * Unit tests for the ingest-lag wait budget resolver.
 *
 * The ClickHouse client is injected, so these tests drive the formula, the
 * clamps, the small-sample default, the error fallback and the in-process
 * cache without any real query.
 *
 * @see specs/scenarios/remote-trace-judging.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearTraceWaitBudgetCache,
  DEFAULT_TRACE_WAIT_TIMEOUT_MS,
  resolveTraceWaitTimeoutMs,
  traceWaitBudgetCacheSize,
} from "../ingest-lag.service";

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: vi.fn(() => mockLogger),
}));

// The production resolver pulls in prisma through the ClickHouse routing
// module; the tests always inject their own resolver, so stub the module out
// of the import graph entirely.
vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: vi.fn(),
}));

function clientReturning(
  rows: Array<{ P95LagMs: number | null; SampleCount: number | string }>,
): { client: ClickHouseClient; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn().mockResolvedValue({
    json: vi.fn().mockResolvedValue(rows),
  });
  return { client: { query } as unknown as ClickHouseClient, query };
}

function resolverFor(client: ClickHouseClient | null) {
  return vi.fn().mockResolvedValue(client);
}

describe("resolveTraceWaitTimeoutMs", () => {
  beforeEach(() => {
    clearTraceWaitBudgetCache();
    mockLogger.warn.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given a project with enough recent traces", () => {
    describe("when the measured p95 lands between the clamps", () => {
      /** @scenario "The wait budget grows with the project's measured ingest lag" */
      it("returns a quarter more than the p95 plus five seconds", async () => {
        const { client } = clientReturning([
          { P95LagMs: 16_000, SampleCount: 100 },
        ]);

        const budget = await resolveTraceWaitTimeoutMs({
          projectId: "proj_1",
          clientResolver: resolverFor(client),
        });

        expect(budget).toBe(1.25 * 16_000 + 5_000);
      });

      /** @scenario "The wait budget rounds up, never down" */
      it("rounds a fractional p95 up to whole milliseconds", async () => {
        // A fractional p95 (ClickHouse quantile interpolates) must not leak a
        // fractional budget: the SDK hands it to timer APIs that reject
        // non-integer delays.
        const { client } = clientReturning([
          { P95LagMs: 16_193.75, SampleCount: 100 },
        ]);

        const budget = await resolveTraceWaitTimeoutMs({
          projectId: "proj_frac",
          clientResolver: resolverFor(client),
        });

        expect(budget).toBe(25_243);
        expect(Number.isInteger(budget)).toBe(true);
      });
    });

    describe("when the measured p95 is very small or very large", () => {
      /** @scenario "The wait budget stays within its floor and ceiling" */
      it("clamps to the ten second floor and the thirty second ceiling", async () => {
        const fast = clientReturning([{ P95LagMs: 500, SampleCount: 100 }]);
        const slow = clientReturning([{ P95LagMs: 600_000, SampleCount: 100 }]);

        const floor = await resolveTraceWaitTimeoutMs({
          projectId: "proj_fast",
          clientResolver: resolverFor(fast.client),
        });
        const ceiling = await resolveTraceWaitTimeoutMs({
          projectId: "proj_slow",
          clientResolver: resolverFor(slow.client),
        });

        expect(floor).toBe(10_000);
        expect(ceiling).toBe(30_000);
      });
    });

    describe("when ClickHouse serializes the count as a string", () => {
      it("parses it and still applies the formula", async () => {
        const { client } = clientReturning([
          { P95LagMs: 16_000, SampleCount: "100" },
        ]);

        const budget = await resolveTraceWaitTimeoutMs({
          projectId: "proj_str",
          clientResolver: resolverFor(client),
        });

        expect(budget).toBe(25_000);
      });
    });
  });

  describe("given a project with fewer than twenty recent traces", () => {
    /** @scenario "A project with few recent traces gets the default wait budget" */
    it("returns the thirty second default", async () => {
      const { client } = clientReturning([
        { P95LagMs: 200_000, SampleCount: 19 },
      ]);

      const budget = await resolveTraceWaitTimeoutMs({
        projectId: "proj_sparse",
        clientResolver: resolverFor(client),
      });

      expect(budget).toBe(DEFAULT_TRACE_WAIT_TIMEOUT_MS);
    });
  });

  describe("given the ingest lag measurement fails", () => {
    /** @scenario "A failed ingest lag measurement never fails the run" */
    it("logs a warning and returns the default instead of throwing", async () => {
      const query = vi.fn().mockRejectedValue(new Error("connection refused"));
      const client = { query } as unknown as ClickHouseClient;

      const budget = await resolveTraceWaitTimeoutMs({
        projectId: "proj_down",
        clientResolver: resolverFor(client),
      });

      expect(budget).toBe(DEFAULT_TRACE_WAIT_TIMEOUT_MS);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "proj_down" }),
        expect.stringContaining("default"),
      );
    });

    it("does not cache the fallback, so a recovered ClickHouse is measured again", async () => {
      const query = vi
        .fn()
        .mockRejectedValueOnce(new Error("connection refused"))
        .mockResolvedValueOnce({
          json: vi
            .fn()
            .mockResolvedValue([{ P95LagMs: 16_000, SampleCount: 100 }]),
        });
      const client = { query } as unknown as ClickHouseClient;
      const clientResolver = resolverFor(client);

      const first = await resolveTraceWaitTimeoutMs({
        projectId: "proj_flaky",
        clientResolver,
      });
      const second = await resolveTraceWaitTimeoutMs({
        projectId: "proj_flaky",
        clientResolver,
      });

      expect(first).toBe(DEFAULT_TRACE_WAIT_TIMEOUT_MS);
      expect(second).toBe(25_000);
      expect(query).toHaveBeenCalledTimes(2);
    });

    it("returns the default when no ClickHouse client is configured", async () => {
      const budget = await resolveTraceWaitTimeoutMs({
        projectId: "proj_noch",
        clientResolver: resolverFor(null),
      });

      expect(budget).toBe(DEFAULT_TRACE_WAIT_TIMEOUT_MS);
    });
  });

  describe("given a budget was just measured", () => {
    /** @scenario "A measured wait budget is reused for an hour" */
    it("serves the cached value for an hour, then measures again", async () => {
      vi.useFakeTimers();
      const { client, query } = clientReturning([
        { P95LagMs: 16_000, SampleCount: 100 },
      ]);
      const clientResolver = resolverFor(client);

      const first = await resolveTraceWaitTimeoutMs({
        projectId: "proj_cached",
        clientResolver,
      });
      const second = await resolveTraceWaitTimeoutMs({
        projectId: "proj_cached",
        clientResolver,
      });
      expect(first).toBe(25_000);
      expect(second).toBe(25_000);
      expect(query).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(61 * 60 * 1000);

      await resolveTraceWaitTimeoutMs({
        projectId: "proj_cached",
        clientResolver,
      });
      expect(query).toHaveBeenCalledTimes(2);
    });

    it("evicts other projects' expired entries instead of holding them forever", async () => {
      vi.useFakeTimers();
      const { client } = clientReturning([
        { P95LagMs: 16_000, SampleCount: 100 },
      ]);
      const clientResolver = resolverFor(client);

      await resolveTraceWaitTimeoutMs({
        projectId: "proj_old",
        clientResolver,
      });
      expect(traceWaitBudgetCacheSize()).toBe(1);

      vi.advanceTimersByTime(61 * 60 * 1000);

      // Resolving any project sweeps every expired entry, so a project that
      // stops running scenarios does not keep a cache row resident.
      await resolveTraceWaitTimeoutMs({
        projectId: "proj_new",
        clientResolver,
      });
      expect(traceWaitBudgetCacheSize()).toBe(1);
    });

    it("caches per project", async () => {
      const a = clientReturning([{ P95LagMs: 16_000, SampleCount: 100 }]);
      const b = clientReturning([{ P95LagMs: 8_000, SampleCount: 100 }]);

      const budgetA = await resolveTraceWaitTimeoutMs({
        projectId: "proj_a",
        clientResolver: resolverFor(a.client),
      });
      const budgetB = await resolveTraceWaitTimeoutMs({
        projectId: "proj_b",
        clientResolver: resolverFor(b.client),
      });

      expect(budgetA).toBe(25_000);
      expect(budgetB).toBe(15_000);
    });
  });

  describe("given the query executes", () => {
    it("filters by tenant first and bounds the partition column", async () => {
      const { client, query } = clientReturning([
        { P95LagMs: 16_000, SampleCount: 100 },
      ]);

      await resolveTraceWaitTimeoutMs({
        projectId: "proj_q",
        clientResolver: resolverFor(client),
      });

      const call = query.mock.calls[0]![0] as {
        query: string;
        query_params: Record<string, unknown>;
      };
      expect(call.query_params).toEqual({ tenantId: "proj_q" });
      expect(call.query).toContain("FROM stored_spans");
      expect(call.query).toContain("TenantId = {tenantId:String}");
      expect(call.query).toContain("StartTime >= now() - INTERVAL 7 DAY");
      expect(call.query).toContain(
        "dateDiff('millisecond', max(EndTime), max(CreatedAt))",
      );
    });
  });
});

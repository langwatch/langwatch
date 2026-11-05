/**
 * A ClickHouse refusal is translated once on every analytics read through the proof's fenced
 * reader: a memory-limit error reaches the panel as the handled
 * `query_memory_exceeded` with its copy, not as an unknown 500.
 */
import { ClickHouseQueryClient, type QueryDriver, TenantGuard } from "@langwatch/clickhouse-client";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { analyticsProof } from "../../__tests__/analytics-proof.fixture.ts";
import { ClickHouseAnalyticsRepository } from "../clickhouse.analytics.repository.ts";

/** The error `@clickhouse/client` raises when a statement passes its memory limit. */
function memoryLimitExceeded(): Error {
  return Object.assign(
    new Error(
      "Code: 241. DB::Exception: Memory limit (for query) exceeded: would use 9.31 GiB. (MEMORY_LIMIT_EXCEEDED)",
    ),
    { code: "241", type: "MEMORY_LIMIT_EXCEEDED" },
  );
}

function repositoryOver(driver: QueryDriver) {
  const clickhouse = new ClickHouseQueryClient({ tenantGuard: new TenantGuard(), driver });
  return ClickHouseAnalyticsRepository.create({ clickhouse });
}

const failingWith = (error: () => Error): QueryDriver => ({
  execute: () => Promise.reject(error()),
  insert: () => Promise.reject(error()),
  command: () => Promise.reject(error()),
});

const readInput = {
  authorization: analyticsProof({ projectId: "project-1", permission: "cost:view" }),
  projectId: "project-1",
  startDate: 0,
  endDate: 1_000,
  filters: {},
};

describe("ClickHouseAnalyticsRepository", () => {
  describe("when ClickHouse refuses a panel read with a memory-limit error", () => {
    /** @scenario "A panel read that runs out of ClickHouse memory fails with the handled memory error" */
    it("fails the top documents read with query_memory_exceeded", async () => {
      const raw = memoryLimitExceeded();
      const repository = repositoryOver(failingWith(() => raw));

      const failure: unknown = await repository.findTopDocuments(readInput).then(
        () => null,
        (error: unknown) => error,
      );

      expect(failure).toMatchObject({
        code: "query_memory_exceeded",
        httpStatus: 422,
        fault: "customer",
        reasons: [raw],
      });
    });

    it("fails the feedbacks read with query_memory_exceeded", async () => {
      const repository = repositoryOver(failingWith(memoryLimitExceeded));

      await expect(repository.findFeedbackEvents(readInput)).rejects.toMatchObject({
        code: "query_memory_exceeded",
      });
    });

    it("fails a series read through the proof with query_memory_exceeded", async () => {
      const raw = memoryLimitExceeded();
      const repository = repositoryOver(failingWith(() => raw));
      const startDate = Temporal.Instant.from("2026-07-01T00:00:00Z");

      const failure = repository.runTimeseries({
        table: "trace_analytics_rollup",
        authorization: analyticsProof({ projectId: "project-1" }),
        input: {
          projectId: "project-1",
          startDate: startDate.epochMilliseconds,
          endDate: startDate.epochMilliseconds + 1_000,
          filters: {},
          series: [{ metric: "performance.total_cost", aggregation: "sum" }],
          timeScale: "full",
          timeZone: "UTC",
        },
        startDate,
        endDate: startDate.add({ seconds: 1 }),
        previousPeriodStartDate: startDate,
        adjustedTimeScale: "full",
        maxResultRows: undefined,
      });

      await expect(failure).rejects.toMatchObject({
        code: "query_memory_exceeded",
        reasons: [raw],
      });
    });
  });

  describe("when ClickHouse fails a read with an error it has no handled form for", () => {
    it("rethrows the raw error", async () => {
      const raw = Object.assign(new Error("Code: 1000. DB::Exception: boom"), { code: "1000" });
      const repository = repositoryOver(failingWith(() => raw));

      await expect(repository.findTopDocuments(readInput)).rejects.toBe(raw);
    });
  });
});

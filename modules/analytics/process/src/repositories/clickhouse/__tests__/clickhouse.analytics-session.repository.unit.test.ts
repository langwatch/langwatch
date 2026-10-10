/**
 * Every analytics panel read goes through the per-tenant session, so a ClickHouse refusal is
 * translated there once: a memory-limit error reaches the panel as the handled
 * `query_memory_exceeded` with its copy, not as an unknown 500.
 */
import { ClickHouseQueryClient, type QueryDriver, TenantGuard } from "@langwatch/clickhouse-client";
import { describe, expect, it } from "vitest";

import { ClickHouseAnalyticsSessionsRepository } from "../clickhouse.analytics-sessions.repository.ts";
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
  const sessions = ClickHouseAnalyticsSessionsRepository.create(
    new ClickHouseQueryClient({ tenantGuard: new TenantGuard(), driver }),
  );
  return ClickHouseAnalyticsRepository.create({
    resolveClient: (tenantId) => sessions.resolve(tenantId),
  });
}

const failingWith = (error: () => Error): QueryDriver => ({
  execute: () => Promise.reject(error()),
  insert: () => Promise.reject(error()),
  command: () => Promise.reject(error()),
});

const readInput = { projectId: "project-1", startDate: 0, endDate: 1_000, filters: {} };

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
  });

  describe("when ClickHouse fails a read with an error it has no handled form for", () => {
    it("rethrows the raw error", async () => {
      const raw = Object.assign(new Error("Code: 1000. DB::Exception: boom"), { code: "1000" });
      const repository = repositoryOver(failingWith(() => raw));

      await expect(repository.findTopDocuments(readInput)).rejects.toBe(raw);
    });
  });
});

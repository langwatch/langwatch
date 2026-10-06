import { nowInstant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { AnalyticsRecencyRepository } from "../../analytics-recency.repository.ts";
import { MemoryAnalyticsRecencyRepository } from "../memory.analytics-recency.repository.ts";
import { MemoryAnalyticsSessionsRepository } from "../memory.analytics-sessions.repository.ts";
import { MemoryLangWatchQLAppFunctionStoreRepository } from "../memory.langwatch-ql-app-function-store.repository.ts";

describe("the analytics memory tier", () => {
  describe("when a tenant's session is resolved", () => {
    it("takes a write and answers a read with no rows, never refusing", async () => {
      const session = await MemoryAnalyticsSessionsRepository.create().resolve("project-1");

      await expect(
        session.insert({
          table: "evaluation_analytics",
          values: [{ TenantId: "project-1", EvaluationId: "evaluation-1" }],
          format: "JSONEachRow",
        }),
      ).resolves.toBeUndefined();
      const result = await session.query({
        query: "SELECT * FROM evaluation_analytics WHERE TenantId = {tenantId:String}",
        query_params: { tenantId: "project-1" },
        format: "JSONEachRow",
      });
      await expect(result.json()).resolves.toEqual([]);
    });
  });

  it("knows no newest row for any source", async () => {
    const recency: AnalyticsRecencyRepository = MemoryAnalyticsRecencyRepository.create();

    await expect(
      recency.findLastOccurredAt({
        projectId: "project-1",
        source: "trace",
        since: nowInstant(),
      }),
    ).resolves.toEqual([]);
  });

  it("answers the app-function store probe with nothing, as a silent server does", async () => {
    await expect(MemoryLangWatchQLAppFunctionStoreRepository.create().findProbe()).resolves.toEqual(
      [],
    );
  });
});

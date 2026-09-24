/**
 * @vitest-environment node
 */
import { createTenantId, type StoredProjection } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import type { IngestionPullRunStatusData } from "../../eventing/ingestion-pull-run-status-eventing.projection.ts";
import { MemoryIngestionPullRunRepository } from "../memory/memory.ingestion-pull-run.repository.ts";

function runStatus(sourceId: string): StoredProjection<IngestionPullRunStatusData> {
  return {
    state: {
      SourceId: sourceId,
      Enabled: true,
      Cron: "0 * * * *",
      Cursor: null,
      LastRunAt: null,
      LastRunOutcome: null,
      LastRunEventCount: 0,
      LastRunError: null,
      LastRunErrorCode: null,
      ConsecutiveErrors: 0,
      LastRunScheduledFor: null,
      LastSuccessAt: null,
      LastReadThroughAt: null,
      LastRunCompleteness: null,
      CreatedAt: 1,
      UpdatedAt: 1,
      LastEventOccurredAt: 1,
    },
    cursor: { acceptedAt: 1, eventId: "event-1" },
    occurredAt: 1,
    createdAt: 1,
    updatedAt: 1,
    version: "1",
  };
}

const project = (tenantId: string) => ({
  aggregateId: "source-1",
  tenantId: createTenantId(tenantId),
});

describe("given the memory run-status repository", () => {
  describe("when a source's run status is stored", () => {
    it("reads it back under the same project", async () => {
      const runs = MemoryIngestionPullRunRepository.create();
      await runs.store(runStatus("source-1"), project("project-1"));

      await expect(runs.get("source-1", project("project-1"))).resolves.toMatchObject({
        kind: "folded",
        projection: { state: { SourceId: "source-1", Cron: "0 * * * *" } },
      });
    });

    it("reads nothing under another project", async () => {
      const runs = MemoryIngestionPullRunRepository.create();
      await runs.store(runStatus("source-1"), project("project-1"));

      await expect(runs.get("source-1", project("project-2"))).resolves.toEqual({ kind: "empty" });
    });

    it("answers a listing summary only for the sources the project holds", async () => {
      const runs = MemoryIngestionPullRunRepository.create();
      await runs.store(runStatus("source-1"), project("project-1"));

      const listings = await runs.findAgentsListings({
        sourceIds: ["source-1", "source-2"],
        projectId: "project-1",
      });

      expect([...listings.keys()]).toEqual(["source-1"]);
    });
  });
});

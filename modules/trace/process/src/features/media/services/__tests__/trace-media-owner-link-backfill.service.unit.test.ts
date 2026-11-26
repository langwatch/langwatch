/**
 * @vitest-environment node
 * The upgrade step asks the project's trace retention, then has Stored Objects link its media.
 * @see modules/stored-object/specs/stored-object-reuse-and-retention.feature
 */
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type {
  LinkUnownedStoredObjectsInput,
  StoredObjectApi,
} from "@langwatch/stored-object-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import {
  TraceMediaOwnerLinkBackfillService,
  TraceMediaRetentionChangedError,
} from "../trace-media-owner-link-backfill.service.ts";

function backfillWith({ retentions }: { retentions: number[] }) {
  const asked: LinkUnownedStoredObjectsInput[] = [];
  const answers = [...retentions];
  const backfill = TraceMediaOwnerLinkBackfillService.create({
    storedObjects: createApiFixture<StoredObjectApi>({
      linkUnownedObjects: async (input) => {
        asked.push(input);
        return { scanned: 4, linked: 3 };
      },
    }),
    retention: createApiFixture<DataRetentionApi>({
      getRetentionDays: async ({ category }) => {
        if (category !== "traces") return 1;
        return answers.length > 1 ? (answers.shift() ?? 0) : (answers[0] ?? 0);
      },
    }),
  });
  return { backfill, asked };
}

describe("TraceMediaOwnerLinkBackfillService", () => {
  describe("when the backfill step runs for a project that keeps traces for 30 days", () => {
    /** @scenario "Trace media stored before owner links is linked to the trace that stored it" */
    it("links its trace media for 30 days and reports the counts", async () => {
      const { backfill, asked } = backfillWith({ retentions: [30] });

      const outcome = await backfill.linkProject({ tenantId: "project_1" });

      expect(asked).toEqual([
        { projectId: "project_1", purpose: "trace_content", retentionDays: 30 },
      ]);
      expect(outcome).toMatchObject({ status: "finalized", report: { scanned: 4, linked: 3 } });
    });
  });

  describe("when the project's trace retention changes during the pass", () => {
    /** @scenario "A trace retention change during the trace media backfill fails the step by name" */
    it("fails the step, naming the project and both retentions", async () => {
      const { backfill } = backfillWith({ retentions: [30, 90] });

      const run = backfill.linkProject({ tenantId: "project_1" });

      await expect(run).rejects.toBeInstanceOf(TraceMediaRetentionChangedError);
      await expect(run).rejects.toThrow("project_1 changed from 30 to 90 days");
    });
  });
});

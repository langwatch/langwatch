/**
 * @vitest-environment node
 * The upgrade step asks the project's trace retention, then has Stored Objects link its media.
 * @see modules/stored-object/specs/stored-object-reuse-and-retention.feature
 */
import type { LinkUnownedStoredObjectsInput } from "@langwatch/stored-object-contract";
import { describe, expect, it } from "vitest";

import { TraceMediaOwnerLinkBackfillService } from "../trace-media-owner-link-backfill.service.ts";

describe("TraceMediaOwnerLinkBackfillService", () => {
  describe("when the backfill step runs for a project that keeps traces for 30 days", () => {
    /** @scenario "Trace media stored before owner links is linked to the trace that stored it" */
    it("links its trace media for 30 days and reports the counts", async () => {
      const asked: LinkUnownedStoredObjectsInput[] = [];
      const backfill = TraceMediaOwnerLinkBackfillService.create({
        storedObjects: {
          linkUnownedObjects: async (input) => {
            asked.push(input);
            return { scanned: 4, linked: 3 };
          },
        },
        retention: {
          getRetentionDays: async ({ category }) => (category === "traces" ? 30 : 1),
        },
      });

      const outcome = await backfill.linkProject({ tenantId: "project_1" });

      expect(asked).toEqual([
        { projectId: "project_1", purpose: "trace_content", retentionDays: 30 },
      ]);
      expect(outcome).toMatchObject({ status: "finalized", report: { scanned: 4, linked: 3 } });
    });
  });
});

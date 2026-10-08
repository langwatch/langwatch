import { Temporal, toDate } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { dataRetentionScopeRowFor } from "../seed-data-retention.ts";

const project = {
  id: "local-dev-project",
  organizationId: "local-dev-organization",
  teamId: "local-dev-team",
} as const;

describe("seeding data retention's scope row for the seeded project", () => {
  describe("when the storage seed runs", () => {
    /** @scenario "The seeded project resolves its data retention without a lifecycle fact" */
    it("names the organization and team, and no fact time", () => {
      const row = dataRetentionScopeRowFor({ project });

      expect(row).toEqual({
        projectId: "local-dev-project",
        organizationId: "local-dev-organization",
        teamId: "local-dev-team",
        updatedAt: toDate(Temporal.Instant.fromEpochMilliseconds(0)),
      });
      expect(row.teamRecordedAt).toBeUndefined();
      expect(row.archivedAt).toBeUndefined();
    });
  });
});

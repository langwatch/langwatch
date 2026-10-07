import { describe, expect, it } from "vitest";

import { dataPrivacyScopeRowFor } from "../seed-data-privacy.ts";

const project = {
  id: "local-dev-project",
  organizationId: "local-dev-organization",
  teamId: "local-dev-team",
  departmentId: null,
  isPersonal: false,
} as const;

describe("seeding data privacy's scope row for the seeded project", () => {
  describe("when the storage seed runs", () => {
    /** @scenario "The seeded project resolves its data privacy without a lifecycle fact" */
    it("names the organization, team, department and personal flag, and no fact time", () => {
      const row = dataPrivacyScopeRowFor({ project });

      expect(row).toEqual({
        projectId: "local-dev-project",
        organizationId: "local-dev-organization",
        teamId: "local-dev-team",
        departmentId: null,
        isPersonal: false,
      });
      expect(row.teamRecordedAt).toBeUndefined();
      expect(row.departmentRecordedAt).toBeUndefined();
      expect(row.archivedAt).toBeUndefined();
    });
  });
});

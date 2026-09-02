/**
 * Which projects a reader could replicate into.
 *
 * `platform/app/src/hooks/useProjectsForCopy.ts` decided this by importing
 * `~/server/api/rbac` into a browser hook, and NOTHING ASSERTED IT: getting it
 * wrong either hides a project the reader may write to, or offers one the
 * server then refuses with a 401 the dialog reports as a generic failure.
 *
 * The interesting cases are the two the platform hook handled implicitly — a
 * custom role whose permission column has never been written, and a legacy role
 * string nothing recognises.
 *
 * Spec: specs/evaluations/evaluation-pages.feature
 */

import { describe, expect, it } from "vitest";

import { uiCopyTargets, type UiCopyOrganization } from "../src/model/ui-copy-targets";

const PERMISSION = "evaluations:manage";

const organizations = (teams: UiCopyOrganization["teams"]): UiCopyOrganization[] => [
  { name: "Acme", teams },
];

describe("given a reader who administers one team and only views another", () => {
  describe("when the replication targets are derived", () => {
    /** @scenario "A replication target I cannot create in is listed rather than hidden" */
    it("lists both, and marks the one they may not create in as closed", () => {
      const targets = uiCopyTargets({
        organizations: organizations([
          {
            name: "Engineering",
            members: [{ userId: "user_1", role: "ADMIN" }],
            projects: [{ id: "proj_1", name: "Web App" }],
          },
          {
            name: "Support",
            members: [{ userId: "user_1", role: "VIEWER" }],
            projects: [{ id: "proj_2", name: "Helpdesk" }],
          },
        ]),
        userId: "user_1",
        permission: PERMISSION,
      });

      expect(targets).toEqual([
        { id: "proj_1", name: "Acme / Engineering / Web App", canCreate: true },
        { id: "proj_2", name: "Acme / Support / Helpdesk", canCreate: false },
      ]);
    });
  });
});

describe("given a team the reader holds no membership row in", () => {
  describe("when the replication targets are derived", () => {
    /** @scenario "A team I am not a member of contributes no replication targets" */
    it("contributes none of that team's projects at all", () => {
      const targets = uiCopyTargets({
        organizations: organizations([
          {
            name: "Finance",
            members: [{ userId: "someone_else", role: "ADMIN" }],
            projects: [{ id: "proj_3", name: "Billing" }],
          },
        ]),
        userId: "user_1",
        permission: PERMISSION,
      });

      expect(targets).toEqual([]);
    });
  });
});

describe("given a custom role whose own permission list is set", () => {
  describe("when the replication targets are derived", () => {
    /** @scenario "A replication target I cannot create in is listed rather than hidden" */
    it("answers from the assigned permissions rather than from the built-in role", () => {
      const targets = uiCopyTargets({
        organizations: organizations([
          {
            name: "Engineering",
            members: [
              {
                userId: "user_1",
                role: "CUSTOM",
                assignedRole: { permissions: [PERMISSION] },
              },
            ],
            projects: [{ id: "proj_1", name: "Web App" }],
          },
        ]),
        userId: "user_1",
        permission: PERMISSION,
      });

      expect(targets[0]?.canCreate).toBe(true);
    });

    /** @scenario "A replication target I cannot create in is listed rather than hidden" */
    it("falls through to the built-in role when the column has never been written", () => {
      const withEmptyList = uiCopyTargets({
        organizations: organizations([
          {
            name: "Engineering",
            members: [{ userId: "user_1", role: "ADMIN", assignedRole: { permissions: [] } }],
            projects: [{ id: "proj_1", name: "Web App" }],
          },
        ]),
        userId: "user_1",
        permission: PERMISSION,
      });

      expect(withEmptyList[0]?.canCreate).toBe(true);
    });
  });
});

describe("given a legacy role string nothing recognises", () => {
  describe("when the replication targets are derived", () => {
    /** @scenario "A replication target I cannot create in is listed rather than hidden" */
    it("reads it as the most restrictive role rather than as permission", () => {
      const targets = uiCopyTargets({
        organizations: organizations([
          {
            name: "Engineering",
            members: [{ userId: "user_1", role: "OWNER_LEGACY" }],
            projects: [{ id: "proj_1", name: "Web App" }],
          },
        ]),
        userId: "user_1",
        permission: PERMISSION,
      });

      expect(targets[0]?.canCreate).toBe(false);
    });
  });
});

describe("given nobody signed in", () => {
  describe("when the replication targets are derived", () => {
    /** @scenario "A team I am not a member of contributes no replication targets" */
    it("offers nothing rather than every project in the graph", () => {
      const targets = uiCopyTargets({
        organizations: organizations([
          {
            name: "Engineering",
            members: [{ userId: "user_1", role: "ADMIN" }],
            projects: [{ id: "proj_1", name: "Web App" }],
          },
        ]),
        userId: undefined,
        permission: PERMISSION,
      });

      expect(targets).toEqual([]);
    });
  });
});

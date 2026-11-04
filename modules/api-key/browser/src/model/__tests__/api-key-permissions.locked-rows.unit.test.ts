// Replicates the create-key drawer locking every Restricted row for a caller the server would let
// mint Traces read + Annotations read. The drawer rebuilds the caller's ceiling from their direct
// USER grants only (`apiKey.myBindings`), nearest binding first; the server checks the real
// resolver (`findPermissionsBeyondCaller`), which also counts group grants.
import { PERMISSION_CATEGORIES } from "@langwatch/api-key-contract";
import { describe, expect, it } from "vitest";

import { categoryAccessAvailability, getUserPermissionsAtScope } from "../api-key-permissions.ts";

const ORGANIZATION_ID = "org_1";
const TEAM_ID = "team_1";
const PROJECT_ID = "project_1";

function openRows({
  myBindings,
  orgProjects = [{ id: PROJECT_ID, teamId: TEAM_ID }],
}: {
  myBindings: { scopeType: string; scopeId: string; role: string }[];
  orgProjects?: { id: string; teamId: string }[];
}): string[] {
  const userPermissions = getUserPermissionsAtScope({
    myBindings,
    scopeType: "PROJECT",
    scopeId: PROJECT_ID,
    organizationId: ORGANIZATION_ID,
    orgProjects,
    isServiceKey: false,
  });
  return PERMISSION_CATEGORIES.filter((category) => {
    const { canRead, canWrite } = categoryAccessAvailability({ category, userPermissions });
    return canRead || canWrite;
  }).map((category) => category.key);
}

const orgMember = { scopeType: "ORGANIZATION", scopeId: ORGANIZATION_ID, role: "MEMBER" };

describe("create-key drawer ceiling for a project-scoped Restricted key", () => {
  describe("when the caller's only direct grant is an organization Member role", () => {
    // A team or project role reached through a group is not in `myBindings`, so this is
    // what the drawer sees for a group-granted member.
    it("locks every row, Traces and Annotations included", () => {
      expect(openRows({ myBindings: [orgMember] })).toEqual([]);
    });
  });

  describe("when the caller holds a direct team Member role", () => {
    it("opens Traces and Annotations", () => {
      const rows = openRows({
        myBindings: [orgMember, { scopeType: "TEAM", scopeId: TEAM_ID, role: "MEMBER" }],
      });
      expect(rows).toEqual(expect.arrayContaining(["traces", "annotations"]));
    });
  });

  describe("when the project is missing from the organization's project list", () => {
    // The team hop needs the project's teamId; without it the lookup falls to the
    // organization grant.
    it("locks every row despite a direct team Member role", () => {
      const rows = openRows({
        myBindings: [orgMember, { scopeType: "TEAM", scopeId: TEAM_ID, role: "MEMBER" }],
        orgProjects: [],
      });
      expect(rows).toEqual([]);
    });
  });
});

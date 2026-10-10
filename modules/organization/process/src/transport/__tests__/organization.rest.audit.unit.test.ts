/**
 * @vitest-environment node
 * Sensitive management writes carry a declared audit action; reads and ingest carry none.
 */
import { describe, expect, it } from "vitest";

import { groupsRest } from "../group.rest.ts";
import { organizationManagementRest } from "../organization-management.rest.ts";
import { teamsRest } from "../team.rest.ts";

describe("the management REST audit declaration", () => {
  it("group.rest audits its sensitive writes under their management action", () => {
    const audited = groupsRest.router().routes.filter((route) => route.audit !== undefined);

    expect(audited.map((route) => [route.operation, route.audit])).toEqual(
      expect.arrayContaining([
        ["postApiGroups", "management.group.create"],
        ["deleteApiGroupsById", "management.group.delete"],
        ["postApiGroupsByIdMembers", "management.group.add-member"],
      ]),
    );
  });

  it("organization-management.rest audits its sensitive writes under their management action", () => {
    const audited = organizationManagementRest
      .router()
      .routes.filter((route) => route.audit !== undefined);

    expect(audited.map((route) => [route.operation, route.audit])).toEqual(
      expect.arrayContaining([
        ["updateOrganization", "management.organization.update"],
        ["removeOrganizationMember", "management.member.delete"],
        ["createOrganizationInvites", "management.invite.create"],
      ]),
    );
  });

  it("team.rest audits its sensitive writes under their management action", () => {
    const audited = teamsRest.router().routes.filter((route) => route.audit !== undefined);

    expect(audited.map((route) => [route.operation, route.audit])).toEqual(
      expect.arrayContaining([
        ["createTeam", "management.team.create-team-with-members"],
        ["removeTeamMember", "management.team.remove-member"],
      ]),
    );
  });
});

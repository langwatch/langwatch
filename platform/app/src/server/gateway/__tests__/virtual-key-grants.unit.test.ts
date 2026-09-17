import { describe, expect, it } from "vitest";
import {
  credentialFixture,
  GROUP,
  grant,
  ORG,
  PROJECT,
  role,
  TEAM,
  USER,
} from "~/server/app-layer/authz/__tests__/credential-permissions.fixture";
import { isVisibleToMembership, loadMembershipSet } from "../virtualKey.authz";

describe("virtual key visibility from grants", () => {
  it("shows team and project keys through a live group grant", async () => {
    const fixture = credentialFixture();
    fixture.grants.push(
      grant({ principalType: "GROUP", principalId: GROUP, roleKey: "viewer" }),
    );
    fixture.groups.push({ userId: USER, groupId: GROUP, organizationId: ORG });
    const access = await loadMembershipSet(fixture.prisma, ORG, USER);
    expect(access.teamIds).toEqual(new Set([TEAM]));
    expect(access.projectIds).toEqual(new Set([PROJECT]));
    expect(
      isVisibleToMembership(access, [
        { scopeType: "PROJECT", scopeId: PROJECT },
      ]),
    ).toBe(true);
    expect(
      isVisibleToMembership(access, [
        { scopeType: "TEAM", scopeId: "other-team" },
      ]),
    ).toBe(false);
    expect(fixture.legacyRead).not.toHaveBeenCalled();
  });

  it("does not infer administrator access from an old membership role", async () => {
    const fixture = credentialFixture();
    fixture.memberships.set(USER, { role: "ADMIN", disabledAt: null });
    const access = await loadMembershipSet(fixture.prisma, ORG, USER);
    expect(access.canViewAllScopes).toBe(false);
    expect(access.teamIds.size).toBe(0);
    expect(access.projectIds.size).toBe(0);
  });

  it("honors organization-wide view permission and closes access for a disabled seat", async () => {
    const fixture = credentialFixture();
    fixture.grants.push(
      grant({
        scopeType: "ORGANIZATION",
        scopeId: ORG,
        roleKey: "custom:role-credential",
      }),
    );
    fixture.roles.push(role({ permissions: ["virtualKeys:view"] }));
    expect(
      (await loadMembershipSet(fixture.prisma, ORG, USER)).canViewAllScopes,
    ).toBe(true);
    fixture.memberships.set(USER, { role: "ADMIN", disabledAt: new Date() });
    const access = await loadMembershipSet(fixture.prisma, ORG, USER);
    expect(access.isOrgMember).toBe(false);
    expect(
      isVisibleToMembership(access, [
        { scopeType: "ORGANIZATION", scopeId: ORG },
      ]),
    ).toBe(false);
  });
});

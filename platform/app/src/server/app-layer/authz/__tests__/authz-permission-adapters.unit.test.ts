import { describe, expect, it } from "vitest";
import {
  batchScopePermissions,
  resolveProjectPermission,
  resolveProjectPermissionAny,
  resolveTeamPermission,
} from "~/server/app-layer/authz/permission-adapters";
import type { Session } from "~/server/auth";
import {
  credentialFixture,
  grant,
  ORG,
  PROJECT,
  TEAM,
  USER,
} from "./credential-permissions.fixture";

const session: Session = { user: { id: USER }, expires: "1" };

describe("permission adapter grant head", () => {
  it("resolves a live project grant and never consults legacy state", async () => {
    const fixture = credentialFixture();
    fixture.grants.push(
      grant({ scopeType: "PROJECT", scopeId: PROJECT, roleKey: "admin" }),
    );

    const result = await resolveProjectPermission(
      { prisma: fixture.prisma, session },
      PROJECT,
      "datasets:manage",
    );

    expect(result.permitted).toBe(true);
    expect(fixture.legacyRead).not.toHaveBeenCalled();
    expect(fixture.migrationRead).not.toHaveBeenCalled();
  });

  it("ignores revoked grants", async () => {
    const fixture = credentialFixture();
    fixture.grants.push(
      grant({
        scopeType: "TEAM",
        scopeId: TEAM,
        roleKey: "admin",
        revokedAt: new Date("2026-01-01T00:00:00Z"),
      }),
    );

    const result = await resolveTeamPermission(
      { prisma: fixture.prisma, session },
      TEAM,
      "team:manage",
    );

    expect(result.permitted).toBe(false);
    expect(fixture.grantFindMany).toHaveBeenCalled();
  });

  it("keeps a grant from another organization outside the requested tenant", async () => {
    const fixture = credentialFixture();
    fixture.grants.push(
      grant({
        organizationId: "other-org",
        scopeType: "TEAM",
        scopeId: TEAM,
        roleKey: "admin",
      }),
    );

    const result = await resolveTeamPermission(
      { prisma: fixture.prisma, session },
      TEAM,
      "team:manage",
    );

    expect(result.permitted).toBe(false);
    expect(fixture.grantFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG }),
      }),
    );
  });

  it("returns the engine decision for any-of checks from one grant snapshot", async () => {
    const fixture = credentialFixture();
    fixture.grants.push(
      grant({ scopeType: "PROJECT", scopeId: PROJECT, roleKey: "viewer" }),
    );

    const result = await resolveProjectPermissionAny(
      { prisma: fixture.prisma, session },
      PROJECT,
      ["datasets:manage", "traces:view"],
    );

    expect(result).toMatchObject({ permitted: true });
  });

  it("fails closed for a disabled organization member", async () => {
    const fixture = credentialFixture();
    fixture.memberships.set(USER, {
      role: "MEMBER",
      disabledAt: new Date("2026-01-01T00:00:00Z"),
    });
    fixture.grants.push(
      grant({ scopeType: "TEAM", scopeId: TEAM, roleKey: "admin" }),
    );

    const result = await resolveTeamPermission(
      { prisma: fixture.prisma, session },
      TEAM,
      "team:manage",
    );

    expect(result).toMatchObject({
      permitted: false,
      denialReason: "membership-disabled",
    });
  });

  it("answers batch scopes from the same grant head", async () => {
    const fixture = credentialFixture();
    fixture.grants.push(
      grant({ scopeType: "TEAM", scopeId: TEAM, roleKey: "member" }),
    );

    const result = await batchScopePermissions(
      { prisma: fixture.prisma, session },
      {
        organizationId: ORG,
        teamIds: [TEAM],
        projectIds: [PROJECT],
        projectTeamId: { [PROJECT]: TEAM },
        permission: "traces:view",
      },
    );

    expect(result.teams.get(TEAM)).toBe(true);
    expect(result.projects.get(PROJECT)).toBe(true);
  });
});

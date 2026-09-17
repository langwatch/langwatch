import { describe, expect, it } from "vitest";
import {
  credentialFixture,
  grant,
  KEY,
  ORG,
  PROJECT,
  TEAM,
} from "~/server/app-layer/authz/__tests__/credential-permissions.fixture";
import { resolveVisibleProjects } from "../project-visibility";

describe("API key project visibility", () => {
  it("uses the stored owner even when the caller labels a personal key as a service key", async () => {
    const fixture = credentialFixture();
    fixture.grants.push(grant({ principalType: "API_KEY", principalId: KEY }));
    const query = {
      prisma: fixture.prisma,
      apiKeyId: KEY,
      userId: null,
      organizationId: ORG,
    };
    expect(await resolveVisibleProjects(query)).toEqual({
      kind: "some",
      ids: [],
    });
    fixture.grants.push(grant({ roleKey: "viewer" }));
    expect(await resolveVisibleProjects(query)).toEqual({
      kind: "some",
      ids: [PROJECT],
    });
    expect(fixture.legacyRead).not.toHaveBeenCalled();
  });

  it("returns all for an organization-wide service grant and none after revocation", async () => {
    const fixture = credentialFixture();
    fixture.key.userId = null;
    const binding = grant({
      principalType: "API_KEY",
      principalId: KEY,
      roleKey: "admin",
      scopeType: "ORGANIZATION",
      scopeId: ORG,
    });
    fixture.grants.push(binding);
    const query = {
      prisma: fixture.prisma,
      apiKeyId: KEY,
      userId: null,
      organizationId: ORG,
    };
    expect(await resolveVisibleProjects(query)).toEqual({ kind: "all" });
    binding.revokedAt = new Date();
    expect(await resolveVisibleProjects(query)).toEqual({
      kind: "some",
      ids: [],
    });
  });

  it("does not widen a key with no bound grant", async () => {
    const fixture = credentialFixture();
    fixture.key.userId = null;
    expect(
      await resolveVisibleProjects({
        prisma: fixture.prisma,
        apiKeyId: KEY,
        userId: null,
        organizationId: ORG,
      }),
    ).toEqual({ kind: "some", ids: [] });
    expect(fixture.prisma.project.findMany).not.toHaveBeenCalled();
  });

  it("rejects a result exceeding the cap instead of silently truncating it", async () => {
    const fixture = credentialFixture();
    fixture.key.userId = null;
    fixture.grants.push(grant({ principalType: "API_KEY", principalId: KEY }));
    fixture.projects.push(
      ...Array.from({ length: 5_000 }, (_, index) => ({
        id: `project-${index}`,
        teamId: TEAM,
      })),
    );
    await expect(
      resolveVisibleProjects({
        prisma: fixture.prisma,
        apiKeyId: KEY,
        userId: null,
        organizationId: ORG,
      }),
    ).rejects.toThrow(/more than 5000 projects/);
  });
});

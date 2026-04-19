/**
 * @vitest-environment node
 *
 * Integration tests for PatService. Exercises create / verify / revoke / list
 * / markUsed against a real PostgreSQL database through Prisma. Validates
 * behavior (ceiling enforcement, persisted role bindings, revoke/expiry
 * handling) rather than Prisma call shapes.
 *
 * Requires: PostgreSQL database (Prisma).
 */
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../db";
import {
  PatAlreadyRevokedError,
  PatNotFoundError,
  PatNotOwnedError,
  PatScopeViolationError,
} from "../errors";
import { PatService } from "../pat.service";
import { splitPatToken } from "../pat-token.utils";

// Skip when running in testcontainers-only mode (no full PostgreSQL)
const isTestcontainersOnly = !!process.env.TEST_CLICKHOUSE_URL;

describe.skipIf(isTestcontainersOnly)("PatService integration", () => {
  const ns = `pat-svc-${nanoid(8)}`;

  let service: PatService;

  // Primary org: an admin user (creator) and a viewer user (low-ceiling)
  let adminUserId: string;
  let viewerUserId: string;
  let outsiderUserId: string;
  let organizationId: string;
  let teamId: string;
  let projectId: string;

  // Foreign org: used to prove cross-tenant scope rejection
  let foreignTeamId: string;
  let foreignProjectId: string;

  // A custom role with one permission
  let customRoleId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Test Org", slug: `--test-org-${ns}` },
    });
    organizationId = org.id;

    const team = await prisma.team.create({
      data: {
        name: "Test Team",
        slug: `--test-team-${ns}`,
        organizationId: org.id,
      },
    });
    teamId = team.id;

    const project = await prisma.project.create({
      data: {
        name: "Test Project",
        slug: `--test-project-${ns}`,
        apiKey: `sk-lw-test-${nanoid()}`,
        teamId: team.id,
        language: "en",
        framework: "test",
      },
    });
    projectId = project.id;

    const adminUser = await prisma.user.create({
      data: {
        name: "Admin User",
        email: `admin-${ns}@example.com`,
      },
    });
    adminUserId = adminUser.id;

    const viewerUser = await prisma.user.create({
      data: {
        name: "Viewer User",
        email: `viewer-${ns}@example.com`,
      },
    });
    viewerUserId = viewerUser.id;

    const outsider = await prisma.user.create({
      data: {
        name: "Outsider",
        email: `outsider-${ns}@example.com`,
      },
    });
    outsiderUserId = outsider.id;

    await prisma.organizationUser.createMany({
      data: [
        {
          userId: adminUserId,
          organizationId: org.id,
          role: OrganizationUserRole.ADMIN,
        },
        {
          userId: viewerUserId,
          organizationId: org.id,
          role: OrganizationUserRole.MEMBER,
        },
      ],
    });

    await prisma.teamUser.createMany({
      data: [
        {
          userId: adminUserId,
          teamId: team.id,
          role: TeamUserRole.ADMIN,
        },
        {
          userId: viewerUserId,
          teamId: team.id,
          role: TeamUserRole.VIEWER,
        },
      ],
    });

    // Foreign org — neither user is a member
    const foreignOrg = await prisma.organization.create({
      data: { name: "Foreign Org", slug: `--foreign-org-${ns}` },
    });
    const foreignTeam = await prisma.team.create({
      data: {
        name: "Foreign Team",
        slug: `--foreign-team-${ns}`,
        organizationId: foreignOrg.id,
      },
    });
    foreignTeamId = foreignTeam.id;
    const foreignProject = await prisma.project.create({
      data: {
        name: "Foreign Project",
        slug: `--foreign-project-${ns}`,
        apiKey: `sk-lw-foreign-${nanoid()}`,
        teamId: foreignTeam.id,
        language: "en",
        framework: "test",
      },
    });
    foreignProjectId = foreignProject.id;

    const customRole = await prisma.customRole.create({
      data: {
        name: `Custom Role ${ns}`,
        organizationId: org.id,
        permissions: ["project:view"],
      },
    });
    customRoleId = customRole.id;

    service = PatService.create(prisma);
  });

  afterAll(async () => {
    await prisma.roleBinding.deleteMany({
      where: { organizationId: { in: [organizationId] } },
    }).catch(() => {});
    await prisma.personalAccessToken.deleteMany({
      where: { organizationId },
    }).catch(() => {});
    await prisma.customRole.deleteMany({
      where: { organizationId },
    }).catch(() => {});
    await prisma.teamUser.deleteMany({
      where: { teamId: { in: [teamId] } },
    }).catch(() => {});
    await prisma.organizationUser.deleteMany({
      where: { organizationId },
    }).catch(() => {});
    await prisma.project.deleteMany({
      where: { id: { in: [projectId, foreignProjectId] } },
    }).catch(() => {});
    await prisma.team.deleteMany({
      where: { id: { in: [teamId, foreignTeamId] } },
    }).catch(() => {});
    await prisma.organization.deleteMany({
      where: { slug: { in: [`--test-org-${ns}`, `--foreign-org-${ns}`] } },
    }).catch(() => {});
    await prisma.user.deleteMany({
      where: {
        id: { in: [adminUserId, viewerUserId, outsiderUserId] },
      },
    }).catch(() => {});
  });

  describe("create", () => {
    it("mints a PAT and persists the requested bindings", async () => {
      const result = await service.create({
        name: `CI PAT ${nanoid(6)}`,
        userId: adminUserId,
        organizationId,
        bindings: [
          {
            role: TeamUserRole.MEMBER,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: organizationId,
          },
        ],
      });

      expect(result.token).toMatch(/^pat-lw-/);
      expect(result.pat.userId).toBe(adminUserId);
      expect(result.pat.organizationId).toBe(organizationId);

      const bindings = await prisma.roleBinding.findMany({
        where: { patId: result.pat.id },
      });
      expect(bindings).toHaveLength(1);
      expect(bindings[0]!.role).toBe(TeamUserRole.MEMBER);
      expect(bindings[0]!.scopeType).toBe(RoleBindingScopeType.ORGANIZATION);
      expect(bindings[0]!.scopeId).toBe(organizationId);
    });

    it("rejects when the creator is not a member of the organization", async () => {
      await expect(
        service.create({
          name: "Unauthorized PAT",
          userId: outsiderUserId,
          organizationId,
          bindings: [
            {
              role: TeamUserRole.VIEWER,
              scopeType: RoleBindingScopeType.ORGANIZATION,
              scopeId: organizationId,
            },
          ],
        }),
      ).rejects.toBeInstanceOf(PatScopeViolationError);
    });

    it("rejects when a binding scope crosses tenants", async () => {
      await expect(
        service.create({
          name: "Cross-tenant PAT",
          userId: adminUserId,
          organizationId,
          bindings: [
            {
              role: TeamUserRole.VIEWER,
              scopeType: RoleBindingScopeType.PROJECT,
              scopeId: foreignProjectId,
            },
          ],
        }),
      ).rejects.toBeInstanceOf(PatScopeViolationError);
    });

    it("rejects when the org scope does not match the PAT's org", async () => {
      await expect(
        service.create({
          name: "Wrong-org-scope PAT",
          userId: adminUserId,
          organizationId,
          bindings: [
            {
              role: TeamUserRole.MEMBER,
              scopeType: RoleBindingScopeType.ORGANIZATION,
              scopeId: `org_${nanoid()}`,
            },
          ],
        }),
      ).rejects.toBeInstanceOf(PatScopeViolationError);
    });

    it("rejects when a viewer tries to mint an ADMIN PAT (ceiling)", async () => {
      await expect(
        service.create({
          name: "Viewer-escalation PAT",
          userId: viewerUserId,
          organizationId,
          bindings: [
            {
              role: TeamUserRole.ADMIN,
              scopeType: RoleBindingScopeType.TEAM,
              scopeId: teamId,
            },
          ],
        }),
      ).rejects.toBeInstanceOf(PatScopeViolationError);
    });

    it("rejects CUSTOM bindings with no customRoleId", async () => {
      await expect(
        service.create({
          name: "CUSTOM without id",
          userId: adminUserId,
          organizationId,
          bindings: [
            {
              role: TeamUserRole.CUSTOM,
              scopeType: RoleBindingScopeType.ORGANIZATION,
              scopeId: organizationId,
            },
          ],
        }),
      ).rejects.toBeInstanceOf(PatScopeViolationError);
    });

    it("accepts a CUSTOM binding when the creator holds every permission", async () => {
      const result = await service.create({
        name: `Custom PAT ${nanoid(6)}`,
        userId: adminUserId,
        organizationId,
        bindings: [
          {
            role: TeamUserRole.CUSTOM,
            customRoleId,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: organizationId,
          },
        ],
      });

      const bindings = await prisma.roleBinding.findMany({
        where: { patId: result.pat.id },
      });
      expect(bindings).toHaveLength(1);
      expect(bindings[0]!.customRoleId).toBe(customRoleId);
    });
  });

  describe("verify", () => {
    it("returns the PAT when token is valid and active", async () => {
      const { token, pat } = await service.create({
        name: `verify-valid-${nanoid(6)}`,
        userId: adminUserId,
        organizationId,
        bindings: [
          {
            role: TeamUserRole.VIEWER,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: organizationId,
          },
        ],
      });

      const verified = await service.verify({ token });
      expect(verified).not.toBeNull();
      expect(verified!.id).toBe(pat.id);
    });

    it("returns null when the secret is wrong", async () => {
      const { token } = await service.create({
        name: `verify-wrong-secret-${nanoid(6)}`,
        userId: adminUserId,
        organizationId,
        bindings: [
          {
            role: TeamUserRole.VIEWER,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: organizationId,
          },
        ],
      });
      const parts = splitPatToken(token)!;
      const tampered = `pat-lw-${parts.lookupId}_${"x".repeat(parts.secret.length)}`;

      expect(await service.verify({ token: tampered })).toBeNull();
    });

    it("returns null when the PAT is revoked", async () => {
      const { token, pat } = await service.create({
        name: `verify-revoked-${nanoid(6)}`,
        userId: adminUserId,
        organizationId,
        bindings: [
          {
            role: TeamUserRole.VIEWER,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: organizationId,
          },
        ],
      });
      await service.revoke({ id: pat.id, userId: adminUserId });
      expect(await service.verify({ token })).toBeNull();
    });

    it("returns null when the PAT is expired", async () => {
      const { token, pat } = await service.create({
        name: `verify-expired-${nanoid(6)}`,
        userId: adminUserId,
        organizationId,
        expiresAt: new Date(Date.now() + 60_000),
        bindings: [
          {
            role: TeamUserRole.VIEWER,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: organizationId,
          },
        ],
      });
      // Push expiration into the past
      await prisma.personalAccessToken.update({
        where: { id: pat.id },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });
      expect(await service.verify({ token })).toBeNull();
    });

    it("returns null for malformed tokens", async () => {
      expect(await service.verify({ token: "not-a-pat" })).toBeNull();
    });
  });

  describe("revoke", () => {
    it("revokes a PAT owned by the user", async () => {
      const { pat } = await service.create({
        name: `revoke-owner-${nanoid(6)}`,
        userId: adminUserId,
        organizationId,
        bindings: [
          {
            role: TeamUserRole.VIEWER,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: organizationId,
          },
        ],
      });

      const revoked = await service.revoke({ id: pat.id, userId: adminUserId });
      expect(revoked.revokedAt).not.toBeNull();
    });

    it("throws PatNotOwnedError when another user tries to revoke", async () => {
      const { pat } = await service.create({
        name: `revoke-not-owner-${nanoid(6)}`,
        userId: adminUserId,
        organizationId,
        bindings: [
          {
            role: TeamUserRole.VIEWER,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: organizationId,
          },
        ],
      });

      await expect(
        service.revoke({ id: pat.id, userId: viewerUserId }),
      ).rejects.toBeInstanceOf(PatNotOwnedError);
    });

    it("throws PatAlreadyRevokedError on double-revoke", async () => {
      const { pat } = await service.create({
        name: `revoke-double-${nanoid(6)}`,
        userId: adminUserId,
        organizationId,
        bindings: [
          {
            role: TeamUserRole.VIEWER,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: organizationId,
          },
        ],
      });

      await service.revoke({ id: pat.id, userId: adminUserId });
      await expect(
        service.revoke({ id: pat.id, userId: adminUserId }),
      ).rejects.toBeInstanceOf(PatAlreadyRevokedError);
    });

    it("throws PatNotFoundError for a non-existent PAT", async () => {
      await expect(
        service.revoke({ id: `pat_${nanoid()}`, userId: adminUserId }),
      ).rejects.toBeInstanceOf(PatNotFoundError);
    });
  });

  describe("list", () => {
    it("returns only PATs for the given user and organization, newest first", async () => {
      const isolatedUser = await prisma.user.create({
        data: {
          name: "List Test User",
          email: `list-${ns}@example.com`,
        },
      });
      await prisma.organizationUser.create({
        data: {
          userId: isolatedUser.id,
          organizationId,
          role: OrganizationUserRole.MEMBER,
        },
      });
      await prisma.teamUser.create({
        data: {
          userId: isolatedUser.id,
          teamId,
          role: TeamUserRole.MEMBER,
        },
      });

      const first = await service.create({
        name: `list-first-${nanoid(6)}`,
        userId: isolatedUser.id,
        organizationId,
        bindings: [
          {
            role: TeamUserRole.MEMBER,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: organizationId,
          },
        ],
      });
      // Small delay so createdAt ordering is deterministic
      await new Promise((r) => setTimeout(r, 5));
      const second = await service.create({
        name: `list-second-${nanoid(6)}`,
        userId: isolatedUser.id,
        organizationId,
        bindings: [
          {
            role: TeamUserRole.MEMBER,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: organizationId,
          },
        ],
      });

      const tokens = await service.list({
        userId: isolatedUser.id,
        organizationId,
      });

      expect(tokens.map((t) => t.id)).toEqual([second.pat.id, first.pat.id]);

      await prisma.teamUser.deleteMany({
        where: { userId: isolatedUser.id },
      }).catch(() => {});
      await prisma.organizationUser.deleteMany({
        where: { userId: isolatedUser.id },
      }).catch(() => {});
      await prisma.user.delete({ where: { id: isolatedUser.id } }).catch(() => {});
    });
  });

  describe("markUsed", () => {
    it("updates lastUsedAt asynchronously", async () => {
      const { pat } = await service.create({
        name: `mark-used-${nanoid(6)}`,
        userId: adminUserId,
        organizationId,
        bindings: [
          {
            role: TeamUserRole.MEMBER,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: organizationId,
          },
        ],
      });
      expect(pat.lastUsedAt).toBeNull();

      service.markUsed({ id: pat.id });
      // Poll for eventual consistency — markUsed is fire-and-forget
      let updated = pat;
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 25));
        updated = (await prisma.personalAccessToken.findUnique({
          where: { id: pat.id },
        }))!;
        if (updated.lastUsedAt) break;
      }
      expect(updated.lastUsedAt).not.toBeNull();
    });
  });
});

/**
 * @vitest-environment node
 *
 * Integration tests for TokenResolver. Resolves legacy sk-lw-* keys and
 * pat-lw-* tokens against a real PostgreSQL database, covering the
 * cross-organization rejection, missing-projectId rejection, and the
 * legacy fallback path.
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
import { PatService } from "../pat.service";
import { TokenResolver } from "../token-resolver";

const isTestcontainersOnly = !!process.env.TEST_CLICKHOUSE_URL;

describe.skipIf(isTestcontainersOnly)("TokenResolver integration", () => {
  const ns = `token-resolver-${nanoid(8)}`;

  let resolver: TokenResolver;

  let userId: string;
  let organizationId: string;
  let teamId: string;
  let projectId: string;
  let projectApiKey: string;

  let foreignOrgId: string;
  let foreignProjectId: string;

  let validPatToken: string;
  let validPatId: string;

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

    projectApiKey = `sk-lw-test-${nanoid()}`;
    const project = await prisma.project.create({
      data: {
        name: "Test Project",
        slug: `--test-project-${ns}`,
        apiKey: projectApiKey,
        teamId: team.id,
        language: "en",
        framework: "test",
      },
    });
    projectId = project.id;

    const user = await prisma.user.create({
      data: {
        name: "Test User",
        email: `test-${ns}@example.com`,
      },
    });
    userId = user.id;

    await prisma.organizationUser.create({
      data: {
        userId,
        organizationId: org.id,
        role: OrganizationUserRole.ADMIN,
      },
    });
    await prisma.teamUser.create({
      data: {
        userId,
        teamId: team.id,
        role: TeamUserRole.ADMIN,
      },
    });

    // A foreign organization + project used to prove cross-org rejection
    const foreignOrg = await prisma.organization.create({
      data: { name: "Foreign Org", slug: `--foreign-org-${ns}` },
    });
    foreignOrgId = foreignOrg.id;
    const foreignTeam = await prisma.team.create({
      data: {
        name: "Foreign Team",
        slug: `--foreign-team-${ns}`,
        organizationId: foreignOrg.id,
      },
    });
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

    const patService = PatService.create(prisma);
    const created = await patService.create({
      name: `resolver-pat-${nanoid(6)}`,
      userId,
      organizationId,
      bindings: [
        {
          role: TeamUserRole.MEMBER,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organizationId,
        },
      ],
    });
    validPatToken = created.token;
    validPatId = created.pat.id;

    resolver = TokenResolver.create(prisma);
  });

  afterAll(async () => {
    await prisma.roleBinding.deleteMany({
      where: { organizationId },
    }).catch(() => {});
    await prisma.personalAccessToken.deleteMany({
      where: { organizationId },
    }).catch(() => {});
    await prisma.teamUser.deleteMany({ where: { teamId } }).catch(() => {});
    await prisma.organizationUser
      .deleteMany({ where: { organizationId } })
      .catch(() => {});
    await prisma.project.deleteMany({
      where: { id: { in: [projectId, foreignProjectId] } },
    }).catch(() => {});
    await prisma.team.deleteMany({
      where: {
        organizationId: { in: [organizationId, foreignOrgId] },
      },
    }).catch(() => {});
    await prisma.organization.deleteMany({
      where: {
        slug: { in: [`--test-org-${ns}`, `--foreign-org-${ns}`] },
      },
    }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
  });

  describe("when resolving a legacy sk-lw-* token", () => {
    it("returns the project for a valid key", async () => {
      const result = await resolver.resolve({ token: projectApiKey });
      expect(result).not.toBeNull();
      expect(result!.type).toBe("legacy");
      expect(result!.project.id).toBe(projectId);
      expect(result!.project.team.organizationId).toBe(organizationId);
    });

    it("returns null for an unknown legacy key", async () => {
      const result = await resolver.resolve({
        token: `sk-lw-never-issued-${nanoid()}`,
      });
      expect(result).toBeNull();
    });
  });

  describe("when resolving a pat-lw-* token", () => {
    it("returns PAT context when projectId matches the PAT's organization", async () => {
      const result = await resolver.resolve({
        token: validPatToken,
        projectId,
      });
      expect(result).not.toBeNull();
      if (!result || result.type !== "pat") throw new Error("expected pat");
      expect(result.patId).toBe(validPatId);
      expect(result.userId).toBe(userId);
      expect(result.organizationId).toBe(organizationId);
      expect(result.project.id).toBe(projectId);
    });

    it("returns null when no projectId is provided", async () => {
      const result = await resolver.resolve({ token: validPatToken });
      expect(result).toBeNull();
    });

    it("returns null when the project belongs to a different organization", async () => {
      const result = await resolver.resolve({
        token: validPatToken,
        projectId: foreignProjectId,
      });
      expect(result).toBeNull();
    });

    it("returns null for a revoked PAT", async () => {
      const patService = PatService.create(prisma);
      const { token, pat } = await patService.create({
        name: `revoked-pat-${nanoid(6)}`,
        userId,
        organizationId,
        bindings: [
          {
            role: TeamUserRole.MEMBER,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: organizationId,
          },
        ],
      });
      await patService.revoke({ id: pat.id, userId });

      const result = await resolver.resolve({ token, projectId });
      expect(result).toBeNull();
    });
  });

  describe("when resolving an unknown-prefix token", () => {
    it("falls back to legacy lookup and returns null", async () => {
      const result = await resolver.resolve({ token: "totally-unknown" });
      expect(result).toBeNull();
    });
  });

  describe("markUsed", () => {
    it("updates lastUsedAt on the PAT", async () => {
      resolver.markUsed({ patId: validPatId });
      let pat = await prisma.personalAccessToken.findUnique({
        where: { id: validPatId },
      });
      for (let i = 0; i < 20; i++) {
        if (pat?.lastUsedAt) break;
        await new Promise((r) => setTimeout(r, 25));
        pat = await prisma.personalAccessToken.findUnique({
          where: { id: validPatId },
        });
      }
      expect(pat?.lastUsedAt).not.toBeNull();
    });
  });
});

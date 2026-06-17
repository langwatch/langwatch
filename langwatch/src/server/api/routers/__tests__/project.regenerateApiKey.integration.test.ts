/**
 * @vitest-environment node
 *
 * Integration tests for project.regenerateApiKey mutation.
 * Tests the actual mutation behavior with a real test database.
 *
 * Requires: PostgreSQL database (Prisma)
 */
import { TeamUserRole, OrganizationUserRole } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../db";
import { TokenResolver } from "../../../api-key/token-resolver";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

// Skip when running with testcontainers only (no PostgreSQL)
// TEST_CLICKHOUSE_URL indicates testcontainers mode without full infrastructure
const isTestcontainersOnly = !!process.env.TEST_CLICKHOUSE_URL;

describe.skipIf(isTestcontainersOnly)("project.regenerateApiKey integration", () => {
  const testNamespace = `regen-api-key-${nanoid(8)}`;
  let projectId: string;
  let caller: ReturnType<typeof appRouter.createCaller>;
  // A caller for a user who can view but NOT manage the project, used to prove
  // rotation is gated on `project:manage`.
  let viewerCaller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    // Create isolated test data for this test suite
    const organization = await prisma.organization.create({
      data: {
        name: "Test Organization",
        slug: `--test-org-${testNamespace}`,
      },
    });

    const team = await prisma.team.create({
      data: {
        name: "Test Team",
        slug: `--test-team-${testNamespace}`,
        organizationId: organization.id,
      },
    });

    const project = await prisma.project.create({
      data: {
        name: "Test Project",
        slug: `--test-project-${testNamespace}`,
        apiKey: `sk-lw-test-${nanoid()}`,
        teamId: team.id,
        language: "en",
        framework: "test",
      },
    });
    projectId = project.id;

    const user = await prisma.user.create({
      data: {
        name: "Test User",
        email: `test-${testNamespace}@example.com`,
      },
    });

    // Add user to organization and team
    await prisma.organizationUser.create({
      data: {
        userId: user.id,
        organizationId: organization.id,
        role: OrganizationUserRole.ADMIN,
      },
    });

    await prisma.teamUser.create({
      data: {
        userId: user.id,
        teamId: team.id,
        role: TeamUserRole.ADMIN,
      },
    });

    const ctx = createInnerTRPCContext({
      session: {
        user: { id: user.id },
        expires: "1",
      },
    });
    caller = appRouter.createCaller(ctx);

    // A second user on the SAME org/team/project with view-only roles
    // (org MEMBER + team VIEWER). Neither role grants `project:manage`, so
    // this caller must be rejected when it tries to rotate the base key.
    const viewer = await prisma.user.create({
      data: {
        name: "Viewer User",
        email: `viewer-${testNamespace}@example.com`,
      },
    });
    await prisma.organizationUser.create({
      data: {
        userId: viewer.id,
        organizationId: organization.id,
        role: OrganizationUserRole.MEMBER,
      },
    });
    await prisma.teamUser.create({
      data: {
        userId: viewer.id,
        teamId: team.id,
        role: TeamUserRole.VIEWER,
      },
    });
    const viewerCtx = createInnerTRPCContext({
      session: {
        user: { id: viewer.id },
        expires: "1",
      },
    });
    viewerCaller = appRouter.createCaller(viewerCtx);
  });

  afterAll(async () => {
    // Cleanup test data
    await prisma.project.deleteMany({
      where: { slug: { startsWith: `--test-project-${testNamespace}` } },
    }).catch(() => {});
    await prisma.teamUser.deleteMany({
      where: { team: { slug: `--test-team-${testNamespace}` } },
    }).catch(() => {});
    await prisma.team.deleteMany({
      where: { slug: `--test-team-${testNamespace}` },
    }).catch(() => {});
    await prisma.organizationUser.deleteMany({
      where: { organization: { slug: `--test-org-${testNamespace}` } },
    }).catch(() => {});
    await prisma.organization.deleteMany({
      where: { slug: `--test-org-${testNamespace}` },
    }).catch(() => {});
    await prisma.user.deleteMany({
      where: { email: `test-${testNamespace}@example.com` },
    }).catch(() => {});
    await prisma.user.deleteMany({
      where: { email: `viewer-${testNamespace}@example.com` },
    }).catch(() => {});
  });

  it("regenerates API key for existing project", async () => {
    // Get the original API key
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { apiKey: true },
    });

    if (!project) {
      throw new Error("Test project not found");
    }

    const originalApiKey = project.apiKey;

    // Regenerate the API key
    const result = await caller.project.regenerateApiKey({ projectId });

    // Verify the new key is different
    expect(result.apiKey).not.toBe(originalApiKey);
    expect(result.apiKey).toMatch(/^sk-lw-/);

    // Verify the key was actually updated in the database
    const updatedProject = await prisma.project.findUnique({
      where: { id: projectId },
      select: { apiKey: true },
    });
    expect(updatedProject?.apiKey).toBe(result.apiKey);
    expect(updatedProject?.apiKey).not.toBe(originalApiKey);
  });

  it("returns UNAUTHORIZED for nonexistent project (secure behavior - does not reveal project existence)", async () => {
    await expect(
      caller.project.regenerateApiKey({ projectId: "nonexistent-project-id" }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  describe("given rotation invalidates the previous base key", () => {
    it("makes the old base key stop authenticating and the new one authenticate scoped to the project", async () => {
      const before = await prisma.project.findUnique({
        where: { id: projectId },
        select: { apiKey: true },
      });
      const originalApiKey = before!.apiKey;

      const resolver = TokenResolver.create(prisma);

      // Sanity: the original base key authenticates to this project via the
      // real legacy-key resolution path before rotation.
      const resolvedBefore = await resolver.resolve({ token: originalApiKey });
      expect(resolvedBefore?.type).toBe("legacyProjectKey");
      expect(resolvedBefore?.project.id).toBe(projectId);

      const { apiKey: newApiKey } = await caller.project.regenerateApiKey({
        projectId,
      });

      // The previous raw key no longer resolves to anything.
      const resolvedOld = await resolver.resolve({ token: originalApiKey });
      expect(resolvedOld).toBeNull();

      // The new key resolves, scoped to the same project.
      const resolvedNew = await resolver.resolve({ token: newApiKey });
      expect(resolvedNew?.type).toBe("legacyProjectKey");
      expect(resolvedNew?.project.id).toBe(projectId);
    });
  });

  describe("given a user without project:manage permission", () => {
    it("rejects the rotation and leaves the base key unchanged", async () => {
      const before = await prisma.project.findUnique({
        where: { id: projectId },
        select: { apiKey: true },
      });
      const keyBefore = before!.apiKey;

      await expect(
        viewerCaller.project.regenerateApiKey({ projectId }),
      ).rejects.toMatchObject({
        // checkProjectPermission("project:manage") throws UNAUTHORIZED when the
        // caller lacks the permission (see server/api/rbac.ts checkProjectPermission).
        code: "UNAUTHORIZED",
      });

      const after = await prisma.project.findUnique({
        where: { id: projectId },
        select: { apiKey: true },
      });
      expect(after!.apiKey).toBe(keyBefore);
    });
  });

  describe("given a successful rotation", () => {
    it("records an audit-log entry for the rotation", async () => {
      await caller.project.regenerateApiKey({ projectId });

      const entry = await prisma.auditLog.findFirst({
        where: {
          action: "project.apiKey.regenerated",
          projectId,
        },
      });
      expect(entry).not.toBeNull();
    });
  });
});

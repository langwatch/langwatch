/**
 * @vitest-environment node
 *
 * Integration tests for project.regenerateApiKey mutation.
 * Tests the actual mutation behavior with a real test database.
 *
 * Requires: PostgreSQL database (Prisma)
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OrganizationUserRole, TeamUserRole } from "~/generated/prisma/client";
import { seedRoleBinding } from "~/test-utils/authz-seeds";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { TokenResolver } from "../../../api-key/token-resolver";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

wireDefaultTestApp();

describe("project.regenerateApiKey integration", () => {
  const testNamespace = `regen-api-key-${nanoid(8)}`;
  let projectId: string;
  let organizationId: string;
  /** The key that currently authenticates as the project. */
  let liveKey: string;
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

    organizationId = organization.id;

    // Stored in plaintext, the way a key created before hashed storage is.
    liveKey = `sk-lw-test-${nanoid()}`;
    const project = await prisma.project.create({
      data: {
        name: "Test Project",
        slug: `--test-project-${testNamespace}`,
        apiKey: liveKey,
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

    for (const [userId, role] of [
      [user.id, TeamUserRole.ADMIN],
      [viewer.id, TeamUserRole.VIEWER],
    ] as const) {
      await seedRoleBinding(prisma, {
        organizationId: organization.id,
        userId,
        role,
        scopeType: "TEAM",
        scopeId: team.id,
      });
    }
    await seedRoleBinding(prisma, {
      organizationId: organization.id,
      userId: user.id,
      role: TeamUserRole.ADMIN,
      scopeType: "ORGANIZATION",
      scopeId: organization.id,
    });
  });

  afterAll(async () => {
    const organizations = await prisma.organization.findMany({
      where: { slug: { startsWith: `--test-org-${testNamespace}` } },
      select: { id: true },
    });
    const organizationIds = organizations.map(
      (organization) => organization.id,
    );
    await prisma.grant.deleteMany({
      where: { organizationId: { in: organizationIds } },
    });
    await prisma.roleBinding.deleteMany({
      where: { organizationId: { in: organizationIds } },
    });
    // Cleanup test data
    await prisma.project
      .deleteMany({
        where: { slug: { startsWith: `--test-project-${testNamespace}` } },
      })
      .catch(() => {});
    await prisma.teamUser
      .deleteMany({
        where: {
          team: { slug: { startsWith: `--test-team-${testNamespace}` } },
        },
      })
      .catch(() => {});
    await prisma.team
      .deleteMany({
        where: { slug: { startsWith: `--test-team-${testNamespace}` } },
      })
      .catch(() => {});
    await prisma.organizationUser
      .deleteMany({
        where: { organization: { slug: `--test-org-${testNamespace}` } },
      })
      .catch(() => {});
    await prisma.organization
      .deleteMany({
        where: { slug: { startsWith: `--test-org-${testNamespace}` } },
      })
      .catch(() => {});
    await prisma.user
      .deleteMany({
        where: { email: `test-${testNamespace}@example.com` },
      })
      .catch(() => {});
    await prisma.user
      .deleteMany({
        where: { email: `viewer-${testNamespace}@example.com` },
      })
      .catch(() => {});
  });

  describe("given a project base key", () => {
    /** @scenario "No route reads the base key back" */
    it("offers no route that returns the base key once it is created", async () => {
      expect(Object.keys(appRouter._def.procedures)).not.toContain(
        "project.getProjectAPIKey",
      );

      const { apiKey: token } = await caller.project.regenerateApiKey({
        projectId,
      });
      liveKey = token;

      const payloads = await Promise.all([
        caller.organization.getAll({}),
        caller.team.getTeamsWithMembers({ organizationId }),
        caller.team.getTeamsWithRoleBindings({ organizationId }),
      ]);
      expect(JSON.stringify(payloads)).not.toContain(token);
    });
  });

  describe("given an existing project", () => {
    describe("when regenerating the API key", () => {
      /** @scenario "An admin rotates the base key and sees the new key once" */
      /** @scenario "Rotating the key returns the new key once and stores only its hash" */
      it("returns the new key once and stores only its hash and last four characters", async () => {
        const previousKey = liveKey;
        const result = await caller.project.regenerateApiKey({ projectId });

        expect(result.apiKey).toMatch(/^sk-lw-/);
        expect(result.apiKey).not.toBe(previousKey);
        liveKey = result.apiKey;

        const resolver = TokenResolver.create(prisma);
        await expect(
          resolver.resolve({ token: previousKey }),
        ).resolves.toBeNull();
        const resolved = await resolver.resolve({ token: result.apiKey });
        expect(resolved?.project.id).toBe(projectId);

        const stored = await prisma.project.findUniqueOrThrow({
          where: { id: projectId },
          select: { apiKey: true, apiKeyHash: true, apiKeyLast4: true },
        });
        expect(stored.apiKey).toBeNull();
        expect(stored.apiKeyHash).toMatch(/^[0-9a-f]{64}$/);
        expect(stored.apiKeyHash).not.toContain(result.apiKey);
        expect(stored.apiKeyLast4).toBe(result.apiKey.slice(-4));
      });
    });
  });

  describe("given a nonexistent project", () => {
    describe("when regenerating the API key", () => {
      it("refuses without revealing whether the project exists", async () => {
        await expect(
          caller.project.regenerateApiKey({
            projectId: "nonexistent-project-id",
          }),
        ).rejects.toMatchObject({
          // Same refusal a real-but-forbidden project gets, which is the
          // property under test: the answer must not distinguish "no such
          // project" from "not yours".
          code: "FORBIDDEN",
        });
      });
    });
  });

  describe("given rotation invalidates the previous base key", () => {
    /** @scenario "Rotation invalidates the previous base key" */
    /** @scenario "The base key keeps working until it is explicitly rotated" */
    it("makes the old base key stop authenticating and the new one authenticate scoped to the project", async () => {
      const originalApiKey = liveKey;

      const resolver = TokenResolver.create(prisma);

      // Sanity: the original base key authenticates to this project via the
      // real legacy-key resolution path before rotation.
      const resolvedBefore = await resolver.resolve({
        token: originalApiKey,
      });
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
      liveKey = newApiKey;
    });
  });

  describe("given a user without project:manage permission", () => {
    it("rejects the rotation and leaves the base key unchanged", async () => {
      const before = await prisma.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { apiKeyHash: true },
      });

      await expect(
        viewerCaller.project.regenerateApiKey({ projectId }),
      ).rejects.toMatchObject({
        // `checkProjectPermission` spells UNAUTHORIZED, but attaches a
        // `ProjectPermissionDeniedError` cause and `handledErrorMiddleware`
        // re-derives the wire code from its 403 — so FORBIDDEN is what a
        // caller sees, and what this asserts. The caller is authenticated;
        // they just lack `project:manage`.
        code: "FORBIDDEN",
      });

      const after = await prisma.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { apiKeyHash: true },
      });
      expect(after.apiKeyHash).toBe(before.apiKeyHash);
      const resolved = await TokenResolver.create(prisma).resolve({
        token: liveKey,
      });
      expect(resolved?.project.id).toBe(projectId);
    });
  });

  describe("given a successful rotation", () => {
    /** @scenario "Rotation is recorded for audit" */
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

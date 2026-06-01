import {
  OrganizationUserRole,
  type Organization,
  type Project,
  type Team,
  type User,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { LicenseEnforcementRepository } from "../license-enforcement.repository";

/**
 * Integration tests for LicenseEnforcementRepository.
 *
 * Tests counting logic against a real database to verify:
 * - Archived projects are excluded from getProjectCount
 * - getMembersLiteCount correctly filters by Lite Member (EXTERNAL) role
 * - getMemberCount counts only ADMIN/MEMBER (excluding Lite Member)
 */
describe("LicenseEnforcementRepository Integration", () => {
  let repository: LicenseEnforcementRepository;
  let organization: Organization;
  let team: Team;
  let project: Project;
  let testUser: User;
  const testNamespace = `repo-int-${nanoid(8)}`;

  // Track created resources for cleanup
  const createdProjectIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdOrgUserIds: { organizationId: string; userId: string }[] = [];

  beforeAll(async () => {
    repository = new LicenseEnforcementRepository(prisma);

    // Create test organization
    organization = await prisma.organization.create({
      data: {
        name: `Test Org ${testNamespace}`,
        slug: `test-org-${testNamespace}`,
      },
    });

    // Create test team
    team = await prisma.team.create({
      data: {
        name: `Test Team ${testNamespace}`,
        slug: `test-team-${testNamespace}`,
        organizationId: organization.id,
      },
    });

    // Create test project
    project = await prisma.project.create({
      data: {
        name: `Test Project ${testNamespace}`,
        slug: `test-project-${testNamespace}`,
        apiKey: `api-key-${testNamespace}`,
        teamId: team.id,
        language: "python",
        framework: "openai",
      },
    });

    // Create a test user for membership tests
    testUser = await prisma.user.create({
      data: {
        email: `test-user-${testNamespace}@example.com`,
        name: `Test User ${testNamespace}`,
      },
    });
    createdUserIds.push(testUser.id);
  });

  afterAll(async () => {
    // Cleanup in reverse order of creation (respecting foreign keys)

    // Delete organization users
    for (const orgUser of createdOrgUserIds) {
      await prisma.organizationUser.deleteMany({
        where: {
          organizationId: orgUser.organizationId,
          userId: orgUser.userId,
        },
      });
    }

    // Delete users
    for (const id of createdUserIds) {
      await prisma.user.delete({ where: { id } }).catch(() => {
        /* ignore */
      });
    }

    // Delete extra projects created during tests
    for (const id of createdProjectIds) {
      await prisma.project.delete({ where: { id } }).catch(() => {
        /* ignore */
      });
    }

    // Delete project, team, organization
    await prisma.project.delete({ where: { id: project.id } }).catch(() => {
      /* ignore */
    });
    await prisma.team.delete({ where: { id: team.id } }).catch(() => {
      /* ignore */
    });
    await prisma.organization
      .delete({ where: { id: organization.id } })
      .catch(() => {
        /* ignore */
      });
  });

  // Helper to create a project in the test organization
  async function createProject(options: {
    archived?: boolean;
  }): Promise<Project> {
    const created = await prisma.project.create({
      data: {
        name: `Test Project ${nanoid(6)}`,
        slug: `test-project-${nanoid(6)}`,
        apiKey: `api-key-${nanoid(8)}`,
        teamId: team.id,
        language: "python",
        framework: "openai",
        archivedAt: options.archived ? new Date() : null,
      },
    });
    createdProjectIds.push(created.id);
    return created;
  }

  // Helper to create a user with organization membership
  async function createOrgUser(role: OrganizationUserRole): Promise<User> {
    const user = await prisma.user.create({
      data: {
        email: `org-user-${nanoid(6)}@example.com`,
        name: `Org User ${nanoid(6)}`,
      },
    });
    createdUserIds.push(user.id);

    await prisma.organizationUser.create({
      data: {
        userId: user.id,
        organizationId: organization.id,
        role,
      },
    });
    createdOrgUserIds.push({ organizationId: organization.id, userId: user.id });

    return user;
  }

  // ==========================================================================
  // Project Count Tests
  // Feature: "Counts only non-archived projects toward limit"
  // ==========================================================================

  describe("getProjectCount", () => {
    /** @scenario Counts only non-archived projects toward limit */
    it("excludes archived projects from count", async () => {
      // Given: a baseline (the org already has the base project), plus
      // 2 active projects and 2 archived projects
      const initialCount = await repository.getProjectCount(organization.id);
      await createProject({ archived: false });
      await createProject({ archived: false });
      await createProject({ archived: true });
      await createProject({ archived: true });

      // When: counting projects for license enforcement
      const count = await repository.getProjectCount(organization.id);

      // Then: only active (non-archived) projects increase the count
      expect(count).toBe(initialCount + 2);
    });

    it("counts projects across all teams in the organization", async () => {
      // Given: a second team in the same organization with an active project
      const initialCount = await repository.getProjectCount(organization.id);
      const team2 = await prisma.team.create({
        data: {
          name: `Test Team 2 ${nanoid(6)}`,
          slug: `test-team-2-${nanoid(6)}`,
          organizationId: organization.id,
        },
      });
      const project2 = await prisma.project.create({
        data: {
          name: `Project in Team 2`,
          slug: `project-team-2-${nanoid(6)}`,
          apiKey: `api-key-team-2-${nanoid(8)}`,
          teamId: team2.id,
          language: "python",
          framework: "openai",
        },
      });

      // When: counting projects for the organization
      const count = await repository.getProjectCount(organization.id);

      // Then: count includes projects from both teams
      expect(count).toBe(initialCount + 1);

      // Cleanup
      await prisma.project.delete({ where: { id: project2.id } });
      await prisma.team.delete({ where: { id: team2.id } });
    });
  });

  // ==========================================================================
  // Member Count Tests
  // Feature: getMembersLiteCount filters by Lite Member (EXTERNAL) role
  // ==========================================================================

  describe("getMembersLiteCount", () => {
    it("counts only Lite Member (EXTERNAL) role users", async () => {
      // Given: a mix of ADMIN, MEMBER, and Lite Member (EXTERNAL) users
      await createOrgUser(OrganizationUserRole.ADMIN);
      await createOrgUser(OrganizationUserRole.MEMBER);
      await createOrgUser(OrganizationUserRole.EXTERNAL);
      await createOrgUser(OrganizationUserRole.EXTERNAL);

      // When: counting Lite Member users
      const count = await repository.getMembersLiteCount(organization.id);

      // Then: only Lite Member users are counted
      expect(count).toBe(2);
    });

    it("returns zero when no Lite Member users exist", async () => {
      // Count before creating any more users
      const externalCountBefore =
        await repository.getMembersLiteCount(organization.id);

      // Given: only ADMIN and MEMBER users (no additional Lite Member)
      await createOrgUser(OrganizationUserRole.ADMIN);
      await createOrgUser(OrganizationUserRole.MEMBER);

      // When: counting Lite Member users
      const count = await repository.getMembersLiteCount(organization.id);

      // Then: count should be same as before (only previously created Lite Member)
      expect(count).toBe(externalCountBefore);
    });
  });

  describe("getMemberCount", () => {
    it("counts only ADMIN and MEMBER roles, excluding Lite Member", async () => {
      // Given: members with various roles already exist from previous tests
      const countBefore = await repository.getMemberCount(organization.id);

      // Add one more of each role
      await createOrgUser(OrganizationUserRole.ADMIN);
      await createOrgUser(OrganizationUserRole.MEMBER);
      await createOrgUser(OrganizationUserRole.EXTERNAL);

      // When: counting full members
      const count = await repository.getMemberCount(organization.id);

      // Then: only ADMIN and MEMBER are counted (Lite Member excluded)
      expect(count).toBe(countBefore + 2);
    });
  });

  // ==========================================================================
  // Cross-project counting verification
  // Feature: "Project count query bypasses multi-tenancy protection"
  // ==========================================================================

  describe("cross-project counting", () => {
    it("counts resources across all projects in organization without multi-tenancy errors", async () => {
      // This test verifies the repository can count across projects
      // without triggering "requires a 'projectId'" errors that would
      // occur if using standard Prisma middleware patterns

      // Given: projects exist in the test organization
      const initialCount = await repository.getProjectCount(organization.id);

      // When: we attempt to count (this should not throw)
      let error: Error | null = null;
      let count = 0;
      try {
        count = await repository.getProjectCount(organization.id);
      } catch (e) {
        error = e as Error;
      }

      // Then: no error is thrown and count is returned
      expect(error).toBeNull();
      expect(count).toBeGreaterThanOrEqual(0);
      expect(count).toBe(initialCount);
    });
  });
});

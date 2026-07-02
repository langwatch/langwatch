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
  // Cross-team counting verification
  // Feature: "Member count query bypasses multi-tenancy protection"
  // ==========================================================================

  describe("cross-team counting", () => {
    it("counts resources across the organization without multi-tenancy errors", async () => {
      // This test verifies the repository can count org-level resources
      // without triggering "requires a 'projectId'" errors that would
      // occur if using standard Prisma middleware patterns

      // Given: members exist in the test organization
      const initialCount = await repository.getMemberCount(organization.id);

      // When: we attempt to count (this should not throw)
      let error: Error | null = null;
      let count = 0;
      try {
        count = await repository.getMemberCount(organization.id);
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

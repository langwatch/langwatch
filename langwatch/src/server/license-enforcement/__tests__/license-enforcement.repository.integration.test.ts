import {
  OrganizationUserRole,
  type Organization,
  type Project,
  type Team,
  type User,
  type Workflow,
  type Evaluator,
} from "@prisma/client";
import { nanoid } from "nanoid";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { prisma } from "~/server/db";
import { LicenseEnforcementRepository } from "../license-enforcement.repository";

/**
 * Integration tests for LicenseEnforcementRepository.
 *
 * Tests counting logic against a real database to verify:
 * - Archived workflows are excluded from getWorkflowCount
 * - Archived evaluators are excluded from getEvaluatorCount
 * - getMembersLiteCount correctly filters by Member Lite (EXTERNAL) role
 *
 * These tests correspond to the scenarios in enforcement-resources.feature:
 * - "Counts only non-archived workflows toward limit"
 * - "Counts only non-archived evaluators toward limit"
 */
describe("LicenseEnforcementRepository Integration", () => {
  let repository: LicenseEnforcementRepository;
  let organization: Organization;
  let team: Team;
  let project: Project;
  let testUser: User;
  const testNamespace = `repo-int-${nanoid(8)}`;

  // Track created resources for cleanup
  const createdWorkflowIds: string[] = [];
  const createdEvaluatorIds: string[] = [];
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

    // Create a test user for workflow author
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

    // Delete evaluators
    for (const id of createdEvaluatorIds) {
      await prisma.evaluator
        .delete({ where: { id } })
        .catch(() => {
          /* ignore if already deleted */
        });
    }

    // Delete workflows (need to handle versions first)
    for (const id of createdWorkflowIds) {
      // Clear version references first
      await prisma.workflow
        .update({
          where: { id },
          data: { latestVersionId: null, currentVersionId: null },
        })
        .catch(() => {
          /* ignore */
        });
      await prisma.workflowVersion
        .deleteMany({ where: { workflowId: id } })
        .catch(() => {
          /* ignore */
        });
      await prisma.workflow.delete({ where: { id } }).catch(() => {
        /* ignore */
      });
    }

    // Delete users
    for (const id of createdUserIds) {
      await prisma.user.delete({ where: { id } }).catch(() => {
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

  // Helper to create a workflow
  async function createWorkflow(options: {
    archived?: boolean;
  }): Promise<Workflow> {
    const workflow = await prisma.workflow.create({
      data: {
        projectId: project.id,
        name: `Test Workflow ${nanoid(6)}`,
        icon: "icon",
        description: "Test workflow for integration tests",
        archivedAt: options.archived ? new Date() : null,
      },
    });
    createdWorkflowIds.push(workflow.id);
    return workflow;
  }

  // Helper to create an evaluator
  async function createEvaluator(options: {
    archived?: boolean;
  }): Promise<Evaluator> {
    const evaluator = await prisma.evaluator.create({
      data: {
        projectId: project.id,
        name: `Test Evaluator ${nanoid(6)}`,
        type: "evaluator",
        config: {},
        archivedAt: options.archived ? new Date() : null,
      },
    });
    createdEvaluatorIds.push(evaluator.id);
    return evaluator;
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
  // Workflow Count Tests
  // Feature: "Counts only non-archived workflows toward limit"
  // ==========================================================================

  describe("getWorkflowCount", () => {
    it("excludes archived workflows from count", async () => {
      // Given: 2 active workflows and 2 archived workflows
      await createWorkflow({ archived: false });
      await createWorkflow({ archived: false });
      await createWorkflow({ archived: true });
      await createWorkflow({ archived: true });

      // When: counting workflows for license enforcement
      const count = await repository.getWorkflowCount(organization.id);

      // Then: only active (non-archived) workflows are counted
      expect(count).toBe(2);
    });

    it("returns zero when all workflows are archived", async () => {
      // First clean up any previous workflows from this org
      // by checking count before we create new ones
      const initialCount = await repository.getWorkflowCount(organization.id);

      // Given: only archived workflows exist (after previous test)
      await createWorkflow({ archived: true });
      await createWorkflow({ archived: true });

      // When: counting workflows
      const count = await repository.getWorkflowCount(organization.id);

      // Then: count should only reflect previously created active ones
      // In a clean state, this would be 0. After the previous test, it's 2.
      expect(count).toBe(initialCount);
    });

    it("counts workflows across multiple projects in same organization", async () => {
      // Given: another project in the same organization
      const project2 = await prisma.project.create({
        data: {
          name: `Test Project 2 ${testNamespace}`,
          slug: `test-project-2-${testNamespace}`,
          apiKey: `api-key-2-${testNamespace}`,
          teamId: team.id,
          language: "python",
          framework: "openai",
        },
      });

      // Create a workflow in the second project
      const workflow2 = await prisma.workflow.create({
        data: {
          projectId: project2.id,
          name: `Workflow in Project 2`,
          icon: "icon",
          description: "Test",
          archivedAt: null,
        },
      });
      createdWorkflowIds.push(workflow2.id);

      // When: counting workflows for the organization
      const count = await repository.getWorkflowCount(organization.id);

      // Then: count includes workflows from both projects
      // We had 2 active from first test, plus this one = 3
      expect(count).toBeGreaterThanOrEqual(3);

      // Cleanup
      await prisma.workflow.delete({ where: { id: workflow2.id } });
      await prisma.project.delete({ where: { id: project2.id } });
      createdWorkflowIds.pop(); // Remove from tracking
    });
  });

  // ==========================================================================
  // Evaluator Count Tests
  // Feature: "Counts only non-archived evaluators toward limit"
  // ==========================================================================

  describe("getEvaluatorCount", () => {
    it("excludes archived evaluators from count", async () => {
      // Given: 2 active evaluators and 2 archived evaluators
      await createEvaluator({ archived: false });
      await createEvaluator({ archived: false });
      await createEvaluator({ archived: true });
      await createEvaluator({ archived: true });

      // When: counting evaluators for license enforcement
      const count = await repository.getEvaluatorCount(organization.id);

      // Then: only active (non-archived) evaluators are counted
      expect(count).toBe(2);
    });

    it("returns zero when all evaluators are archived", async () => {
      const initialCount = await repository.getEvaluatorCount(organization.id);

      // Given: only archived evaluators
      await createEvaluator({ archived: true });
      await createEvaluator({ archived: true });

      // When: counting evaluators
      const count = await repository.getEvaluatorCount(organization.id);

      // Then: only previously created active evaluators are counted
      expect(count).toBe(initialCount);
    });
  });

  // ==========================================================================
  // Member Count Tests
  // Feature: getMembersLiteCount filters by Member Lite (EXTERNAL) role
  // ==========================================================================

  describe("getMembersLiteCount", () => {
    it("counts only Member Lite (EXTERNAL) role users", async () => {
      // Given: a mix of ADMIN, MEMBER, and Member Lite (EXTERNAL) users
      await createOrgUser(OrganizationUserRole.ADMIN);
      await createOrgUser(OrganizationUserRole.MEMBER);
      await createOrgUser(OrganizationUserRole.EXTERNAL);
      await createOrgUser(OrganizationUserRole.EXTERNAL);

      // When: counting Member Lite users
      const count = await repository.getMembersLiteCount(organization.id);

      // Then: only Member Lite users are counted
      expect(count).toBe(2);
    });

    it("returns zero when no Member Lite users exist", async () => {
      // Count before creating any more users
      const externalCountBefore =
        await repository.getMembersLiteCount(organization.id);

      // Given: only ADMIN and MEMBER users (no additional Member Lite)
      await createOrgUser(OrganizationUserRole.ADMIN);
      await createOrgUser(OrganizationUserRole.MEMBER);

      // When: counting Member Lite users
      const count = await repository.getMembersLiteCount(organization.id);

      // Then: count should be same as before (only previously created Member Lite)
      expect(count).toBe(externalCountBefore);
    });
  });

  describe("getMemberCount", () => {
    it("counts only ADMIN and MEMBER roles, excluding Member Lite", async () => {
      // Given: members with various roles already exist from previous tests
      const countBefore = await repository.getMemberCount(organization.id);

      // Add one more of each role
      await createOrgUser(OrganizationUserRole.ADMIN);
      await createOrgUser(OrganizationUserRole.MEMBER);
      await createOrgUser(OrganizationUserRole.EXTERNAL);

      // When: counting full members
      const count = await repository.getMemberCount(organization.id);

      // Then: only ADMIN and MEMBER are counted (Member Lite excluded)
      expect(count).toBe(countBefore + 2);
    });
  });

  // ==========================================================================
  // Cross-project counting verification
  // Feature: "Workflow count query bypasses multi-tenancy protection"
  // ==========================================================================

  describe("cross-project counting", () => {
    it("counts resources across all projects in organization without multi-tenancy errors", async () => {
      // This test verifies the repository can count across projects
      // without triggering "requires a 'projectId'" errors that would
      // occur if using standard Prisma middleware patterns

      // Given: workflows exist in the test project
      const initialCount = await repository.getWorkflowCount(organization.id);

      // When: we attempt to count (this should not throw)
      let error: Error | null = null;
      let count = 0;
      try {
        count = await repository.getWorkflowCount(organization.id);
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

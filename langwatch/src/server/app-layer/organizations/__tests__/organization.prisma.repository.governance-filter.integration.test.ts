import {
  type Organization,
  type Project,
  type Team,
  type User,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { PrismaOrganizationRepository } from "../repositories/organization.prisma.repository";

/**
 * Layer-1 invariant test for the hidden internal-governance Project filter.
 *
 * The hidden Governance Project (Project.kind = "internal_governance")
 * is an internal routing/tenancy artifact for IngestionSource data —
 * it must NEVER appear in user-visible Project surfaces. The single
 * choke point that prevents leakage is the `projects` include in
 * `PrismaOrganizationRepository.getAllForUser`. Every UI consumer of
 * "list my projects" flows through this method via
 * `useOrganizationTeamProject`.
 *
 * This test seeds an organization with both an "application" project
 * AND an "internal_governance" project, then asserts the latter is
 * filtered out of the `getAllForUser` result tree.
 *
 * Pairs with:
 *   specs/ai-gateway/governance/architecture-invariants.feature
 *   specs/ai-gateway/governance/ui-contract.feature
 */
describe("PrismaOrganizationRepository — internal_governance project filter", () => {
  let repository: PrismaOrganizationRepository;
  let organization: Organization;
  let team: Team;
  let applicationProject: Project;
  let governanceProject: Project;
  let testUser: User;
  const testNamespace = `gov-filter-${nanoid(8)}`;

  beforeAll(async () => {
    repository = new PrismaOrganizationRepository(prisma);

    organization = await prisma.organization.create({
      data: {
        name: `Test Org ${testNamespace}`,
        slug: `test-org-${testNamespace}`,
      },
    });

    team = await prisma.team.create({
      data: {
        name: `Test Team ${testNamespace}`,
        slug: `test-team-${testNamespace}`,
        organizationId: organization.id,
      },
    });

    applicationProject = await prisma.project.create({
      data: {
        name: `App Project ${testNamespace}`,
        slug: `app-project-${testNamespace}`,
        apiKey: `app-api-key-${testNamespace}`,
        teamId: team.id,
        language: "python",
        framework: "openai",
        // kind defaults to "application" — explicit here for clarity
        kind: "application",
      },
    });

    governanceProject = await prisma.project.create({
      data: {
        name: `Hidden Governance Project ${testNamespace}`,
        slug: `gov-project-${testNamespace}`,
        apiKey: `gov-api-key-${testNamespace}`,
        teamId: team.id,
        language: "python",
        framework: "openai",
        kind: "internal_governance",
      },
    });

    testUser = await prisma.user.create({
      data: {
        email: `gov-filter-test-${testNamespace}@example.com`,
        name: `Test User ${testNamespace}`,
      },
    });

    await prisma.organizationUser.create({
      data: {
        userId: testUser.id,
        organizationId: organization.id,
        role: "ADMIN",
      },
    });
  });

  afterAll(async () => {
    await prisma.project.deleteMany({
      where: { id: { in: [applicationProject.id, governanceProject.id] } },
    });
    await prisma.organizationUser.deleteMany({
      where: { userId: testUser.id },
    });
    await prisma.team.delete({ where: { id: team.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
  });

  describe("when getAllForUser is called for a user whose org has both kinds of projects", () => {
    it("returns the application project", async () => {
      const orgs = await repository.getAllForUser({
        userId: testUser.id,
        isDemo: false,
        demoProjectUserId: "",
        demoProjectId: "",
      });

      const orgUnderTest = orgs.find((o) => o.id === organization.id);
      expect(orgUnderTest).toBeDefined();

      const allProjects = orgUnderTest!.teams.flatMap((t) => t.projects);
      const projectIds = allProjects.map((p) => p.id);

      expect(projectIds).toContain(applicationProject.id);
    });

    it("filters out the internal_governance project", async () => {
      const orgs = await repository.getAllForUser({
        userId: testUser.id,
        isDemo: false,
        demoProjectUserId: "",
        demoProjectId: "",
      });

      const orgUnderTest = orgs.find((o) => o.id === organization.id);
      expect(orgUnderTest).toBeDefined();

      const allProjects = orgUnderTest!.teams.flatMap((t) => t.projects);
      const projectIds = allProjects.map((p) => p.id);
      const projectKinds = allProjects.map((p) => p.kind);

      expect(projectIds).not.toContain(governanceProject.id);
      expect(projectKinds).not.toContain("internal_governance");
    });
  });
});

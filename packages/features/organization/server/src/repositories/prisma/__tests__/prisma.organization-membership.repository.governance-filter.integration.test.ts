/**
 * @vitest-environment node
 *
 * Layer-1 invariant test for the hidden internal-governance Project filter.
 *
 * The hidden Governance Project (Project.kind = "internal_governance")
 * is an internal routing/tenancy artifact for IngestionSource data —
 * it must NEVER appear in user-visible Project surfaces. The single
 * choke point that prevents leakage is the `projects` include in
 * `PrismaOrganizationMembershipRepository.getAllForUser`. Every UI consumer
 * of "list my projects" flows through this method via
 * `useOrganizationTeamProject`.
 *
 * This test seeds an organization with both an "application" project
 * AND an "internal_governance" project, then asserts the latter is
 * filtered out of the `getAllForUser` result tree.
 *
 * Requires LANGWATCH_TEST_DATABASE_URL. Skips cleanly without it so the
 * suite stays runnable on a box with no database.
 *
 * Pairs with:
 *   specs/ai-gateway/governance/architecture-invariants.feature
 *   specs/ai-gateway/governance/ui-contract.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import type {
  Organization,
  PrismaClient,
  Project,
  Team,
  User,
} from "@langwatch/prisma-client/generated";
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import { PrismaOrganizationMembershipRepository } from "../prisma.organization-membership.repository";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

const noopGrantsWriter = {
  attachBindings: async () => ({ attached: [], duplicates: [] }),
  revokeBindingsWhere: async () => 0,
} as unknown as AuthzGrantsService;

describe.skipIf(!DB_URL)(
  "PrismaOrganizationMembershipRepository — internal_governance project filter",
  () => {
    let connection: PrismaConnection | undefined;
    let prisma: PrismaClient | undefined;
    let repository: PrismaOrganizationMembershipRepository;
    let organization: Organization;
    let team: Team;
    let applicationProject: Project;
    let governanceProject: Project;
    let testUser: User;
    const testNamespace = `gov-filter-${nanoid(8)}`;

    beforeAll(async () => {
      connection = PrismaConnectionService.create({
        guard: PrismaTenancyGuardService.create(),
      }).connect(
        PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }),
      );
      prisma = connection.client as PrismaClient;
      repository = PrismaOrganizationMembershipRepository.create({
        database: prisma,
        grants: noopGrantsWriter,
      });

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
      if (!prisma) return;
      await prisma.project.deleteMany({
        where: { id: { in: [applicationProject.id, governanceProject.id] } },
      });
      await prisma.organizationUser.deleteMany({
        where: { userId: testUser.id, organizationId: organization.id },
      });
      await prisma.team.delete({ where: { id: team.id } });
      await prisma.organization.delete({ where: { id: organization.id } });
      await prisma.user.delete({ where: { id: testUser.id } });
      await prisma.$disconnect();
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

      /** @scenario Lane-B test suite asserts every Project consumer filters */
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
  },
);

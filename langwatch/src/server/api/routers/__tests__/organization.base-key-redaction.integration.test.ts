/**
 * @vitest-environment node
 *
 * @see specs/api-keys/project-key-read-access.feature
 *
 * The project base key travels inside the payload the app loads on every page,
 * so gating the endpoints that return it is only half the job — what the
 * session already holds has to be gated too.
 */
import { generate } from "@langwatch/ksuid";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "~/server/db";
import { KSUID_RESOURCES } from "~/utils/constants";
import { globalForApp, resetApp } from "../../../app-layer/app";
import { OrganizationService } from "../../../app-layer/organizations/organization.service";
import { PrismaOrganizationRepository } from "../../../app-layer/organizations/repositories/organization.prisma.repository";
import { createTestApp } from "../../../app-layer/presets";
import { PlanProviderService } from "../../../app-layer/subscription/plan-provider";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

const { mockGetActivePlan } = vi.hoisted(() => ({
  mockGetActivePlan: vi.fn(),
}));

const ns = `basekey-redaction-${nanoid(8)}`;

const callerFor = (userId: string) =>
  appRouter.createCaller(
    createInnerTRPCContext({ session: { user: { id: userId }, expires: "1" } }),
  );

const projectApiKeyFor = async (
  caller: ReturnType<typeof callerFor>,
  projectId: string,
) => {
  const organizations = await caller.organization.getAll({});
  const projects = organizations.flatMap((organization) =>
    organization.teams.flatMap((team) => team.projects),
  );
  return projects.find((project) => project.id === projectId)?.apiKey;
};

describe("Feature: base key in the organizations payload", () => {
  let organizationId: string;
  let teamId: string;
  let projectId: string;
  let baseApiKey: string;

  let updaterCaller: ReturnType<typeof callerFor>;
  let viewerCaller: ReturnType<typeof callerFor>;

  /**
   * Bound at TEAM scope: an organization-scoped MEMBER binding carries only
   * org-level permissions, so it would not grant `project:update` however the
   * redaction behaved.
   */
  const makeUser = async (label: string, teamRole: TeamUserRole) => {
    const user = await prisma.user.create({
      data: { name: `${label} ${ns}`, email: `${label}-${ns}@example.com` },
    });
    await prisma.organizationUser.create({
      data: {
        userId: user.id,
        organizationId,
        role: OrganizationUserRole.MEMBER,
      },
    });
    await prisma.teamUser.create({
      data: { userId: user.id, teamId, role: teamRole },
    });
    await prisma.roleBinding.create({
      data: {
        id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
        organizationId,
        userId: user.id,
        role: teamRole,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: teamId,
      },
    });
    return user.id;
  };

  beforeAll(async () => {
    mockGetActivePlan.mockResolvedValue({
      planSource: "subscription" as const,
      type: "ENTERPRISE",
      name: "Enterprise",
      free: false,
      maxMembers: 100,
      maxMembersLite: 100,
      maxTeams: 50,
      maxProjects: 100,
      maxMessagesPerMonth: 1_000_000,
      maxWorkflows: 50,
      maxPrompts: 50,
      maxEvaluators: 50,
      maxScenarios: 50,
      maxAgents: 50,
      maxExperiments: 50,
      maxOnlineEvaluations: 50,
      maxDatasets: 50,
      maxDashboards: 50,
      maxCustomGraphs: 50,
      maxAutomations: 50,
      canPublish: true,
      prices: { USD: 0, EUR: 0 },
      overrideAddingLimitations: false,
    });
    globalForApp.__langwatch_app = createTestApp({
      organizations: new OrganizationService(
        new PrismaOrganizationRepository(prisma),
        // Not exercised here; the constructor just needs something.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { seedForOrg: async () => {} } as any,
      ),
      planProvider: PlanProviderService.create({
        getActivePlan: mockGetActivePlan,
      }),
    });

    const organization = await prisma.organization.create({
      data: { name: `Base Key Org ${ns}`, slug: `--test-org-${ns}` },
    });
    organizationId = organization.id;

    const team = await prisma.team.create({
      data: {
        name: `Base Key Team ${ns}`,
        slug: `--test-team-${ns}`,
        organizationId,
      },
    });
    teamId = team.id;

    baseApiKey = `test-base-key-${ns}`;
    const project = await prisma.project.create({
      data: {
        name: `Base Key Project ${ns}`,
        slug: `--test-project-${ns}`,
        apiKey: baseApiKey,
        teamId: team.id,
        language: "python",
        framework: "openai",
      },
    });
    projectId = project.id;

    const updaterId = await makeUser("updater", TeamUserRole.MEMBER);
    const viewerId = await makeUser("viewer", TeamUserRole.VIEWER);

    updaterCaller = callerFor(updaterId);
    viewerCaller = callerFor(viewerId);
  });

  afterAll(async () => {
    resetApp();
    await prisma.roleBinding
      .deleteMany({ where: { organizationId } })
      .catch(() => {});
    await prisma.teamUser
      .deleteMany({ where: { team: { organizationId } } })
      .catch(() => {});
    await prisma.project
      .deleteMany({ where: { team: { organizationId } } })
      .catch(() => {});
    await prisma.team.deleteMany({ where: { organizationId } }).catch(() => {});
    await prisma.organizationUser
      .deleteMany({ where: { organizationId } })
      .catch(() => {});
    await prisma.organization
      .delete({ where: { id: organizationId } })
      .catch(() => {});
    await prisma.user
      .deleteMany({ where: { email: { contains: ns } } })
      .catch(() => {});
  });

  describe("given a caller who can change the project", () => {
    /** @scenario The base key stays in the session payload for those who can change the project */
    it("includes the base key in the payload", async () => {
      const apiKey = await projectApiKeyFor(updaterCaller, projectId);

      expect(apiKey).toBe(baseApiKey);
    });
  });

  describe("given a caller who can only view the project", () => {
    /** @scenario The base key is withheld from the session payload for read-only roles */
    it("withholds the base key from the payload", async () => {
      const apiKey = await projectApiKeyFor(viewerCaller, projectId);

      expect(apiKey).toBe("");
      expect(apiKey).not.toBe(baseApiKey);
    });
  });
});

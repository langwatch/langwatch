/**
 * @vitest-environment node
 *
 * @see specs/api-keys/project-key-read-access.feature
 * @see specs/api-keys/project-key-hashed-storage.feature
 *
 * The payloads the app loads on every page carry Project rows. None of them
 * may carry project key material: the base key (still in plaintext on rows the
 * hashing sweep has not cleared), its hash, the internal key or the
 * LangWatchQL key. Only the last four characters are shown.
 */

import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { hashProjectApiKey } from "~/server/api-key/project-api-key";
import { getProjectInternalKey } from "~/server/api-key/project-internal-key";
import { prisma } from "~/server/db";
import { seedRoleBinding } from "~/test-utils/authz-seeds";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
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

const projectInPayload = async (
  caller: ReturnType<typeof callerFor>,
  projectId: string,
) => {
  const organizations = await caller.organization.getAll({});
  const projects = organizations.flatMap((organization) =>
    organization.teams.flatMap((team) => team.projects),
  );
  const project = projects.find((candidate) => candidate.id === projectId);
  // Every claim below is about what a field CONTAINS, and every one of them is
  // satisfied by a project that is not in the payload at all.
  if (!project) {
    throw new Error(
      "the project is missing from the payload — the redaction assertions would be vacuous",
    );
  }
  return project;
};

const projectLangWatchQLKeyFor = async (
  caller: ReturnType<typeof callerFor>,
  projectId: string,
) => (await projectInPayload(caller, projectId)).lwqlKey;

describe("Feature: base key in the organizations payload", () => {
  let organizationId: string;
  let teamId: string;
  let projectId: string;
  let teamSlug: string;
  let baseApiKey: string;
  let baseApiKeyHash: string;
  let internalKey: string;
  /** Database-minted, so the control below is the real stored value. */
  let storedLangWatchQLKey: string;

  let adminCaller: ReturnType<typeof callerFor>;
  let orgAdminCaller: ReturnType<typeof callerFor>;
  let updaterCaller: ReturnType<typeof callerFor>;
  let viewerCaller: ReturnType<typeof callerFor>;

  /**
   * Bound at TEAM scope: an organization-scoped MEMBER binding carries only
   * org-level permissions, so it would not grant `project:update` however the
   * redaction behaved.
   */
  const makeUser = async (
    label: string,
    teamRole: TeamUserRole,
    organizationRole: OrganizationUserRole = OrganizationUserRole.MEMBER,
  ) => {
    const user = await prisma.user.create({
      data: { name: `${label} ${ns}`, email: `${label}-${ns}@example.com` },
    });
    await prisma.organizationUser.create({
      data: {
        userId: user.id,
        organizationId,
        role: organizationRole,
      },
    });
    if (organizationRole === OrganizationUserRole.ADMIN) {
      await seedRoleBinding(prisma, {
        id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
        organizationId,
        userId: user.id,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organizationId,
      });
    }
    await prisma.teamUser.create({
      data: { userId: user.id, teamId, role: teamRole },
    });
    await seedRoleBinding(prisma, {
      id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
      organizationId,
      userId: user.id,
      role: teamRole,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: teamId,
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
    teamSlug = team.slug;

    // A key created before hashed storage, hashed by the sweep and still
    // inside its plaintext grace window: every form of it is stored.
    baseApiKey = `sk-lw-test-base-key-${ns}`;
    baseApiKeyHash = hashProjectApiKey(baseApiKey);
    const project = await prisma.project.create({
      data: {
        name: `Base Key Project ${ns}`,
        slug: `--test-project-${ns}`,
        apiKey: baseApiKey,
        apiKeyHash: baseApiKeyHash,
        apiKeyLast4: baseApiKey.slice(-4),
        apiKeyHashedAt: new Date(),
        teamId: team.id,
        language: "python",
        framework: "openai",
      },
    });
    projectId = project.id;
    storedLangWatchQLKey = project.lwqlKey;
    internalKey = await getProjectInternalKey({ prisma, projectId });

    const adminId = await makeUser("admin", TeamUserRole.ADMIN);
    const updaterId = await makeUser("updater", TeamUserRole.MEMBER);
    const viewerId = await makeUser("viewer", TeamUserRole.VIEWER);

    adminCaller = callerFor(adminId);
    updaterCaller = callerFor(updaterId);
    viewerCaller = callerFor(viewerId);
    orgAdminCaller = callerFor(
      await makeUser(
        "orgadmin",
        TeamUserRole.ADMIN,
        OrganizationUserRole.ADMIN,
      ),
    );
  });

  afterAll(async () => {
    await resetApp();
    await cleanupTestRows(prisma, [
      ["grant", { organizationId }],
      ["projectInternalKey", { projectId }],
      ["roleBinding", { organizationId }],
      ["teamUser", { team: { organizationId } }],
      ["project", { team: { organizationId } }],
      ["team", { organizationId }],
      ["organizationUser", { organizationId }],
      ["organization", { id: organizationId }],
      // Last: makeUser's rows are still referenced by the memberships above.
      ["user", { email: { contains: ns } }],
    ]);
  });

  const secretsOf = () => [baseApiKey, baseApiKeyHash, internalKey];

  describe("given a caller who can manage the project", () => {
    /** @scenario The base key is withheld from the session payload for project admins */
    /** @scenario "The application payload carries no project key material" */
    it("withholds the key and its hash, and keeps the last four characters", async () => {
      const project = await projectInPayload(adminCaller, projectId);

      expect(project.apiKey).toBeNull();
      expect(project.apiKeyHash).toBeNull();
      expect(project.apiKeyLast4).toBe(baseApiKey.slice(-4));

      const payload = JSON.stringify(await adminCaller.organization.getAll({}));
      for (const secret of secretsOf()) {
        expect(payload).not.toContain(secret);
      }
    });
  });

  describe("given a caller who can update but not manage the project", () => {
    /** @scenario The base key is withheld from the session payload for project members */
    it("redacts every key occurrence from the whole organization payload", async () => {
      const organizations = await updaterCaller.organization.getAll({});
      const visibleProjects = organizations.flatMap((organization) =>
        organization.teams.flatMap((team) => team.projects),
      );
      expect(visibleProjects.some((project) => project.id === projectId)).toBe(
        true,
      );
      expect(
        visibleProjects.every(
          (project) => project.apiKey === null && project.apiKeyHash === null,
        ),
      ).toBe(true);
      const payload = JSON.stringify(organizations);
      for (const secret of secretsOf()) {
        expect(payload).not.toContain(secret);
      }
    });
  });

  describe("given a caller who can only view the project", () => {
    /** @scenario The base key is withheld from the session payload for project members */
    it("withholds the key and its hash from the payload", async () => {
      const project = await projectInPayload(viewerCaller, projectId);

      expect(project.apiKey).toBeNull();
      expect(project.apiKeyHash).toBeNull();
    });
  });

  describe("given the team and cost payloads", () => {
    /** @scenario Team and cost payloads carry no project key material */
    it("carries no project key material for an organization admin", async () => {
      const payloads = await Promise.all([
        orgAdminCaller.team.getTeamsWithMembers({ organizationId }),
        orgAdminCaller.team.getTeamWithMembers({
          organizationId,
          slug: teamSlug,
        }),
        orgAdminCaller.team.getTeamsWithRoleBindings({ organizationId }),
        orgAdminCaller.costs.getAggregatedCostsForOrganization({
          organizationId,
          startDate: Date.now() - 24 * 60 * 60 * 1000,
          endDate: Date.now(),
        }),
      ]);
      const [teams] = payloads;
      // Without the project in the payload, the absence below is vacuous.
      expect(
        teams.some((team) =>
          team.projects.some((project) => project.id === projectId),
        ),
      ).toBe(true);

      const payload = JSON.stringify(payloads);
      for (const secret of [...secretsOf(), storedLangWatchQLKey]) {
        expect(payload).not.toContain(secret);
      }
    });
  });

  /**
   * The LangWatchQL key is a control-plane secret, not a credential any client
   * surface renders: it is the input to the tenant capability the LangWatchQL
   * analytics API presents to ClickHouse. So unlike the base key it is withheld
   * from *everyone*, and the caller who CAN change the project is the case that
   * matters — a redaction gated on permission would hand it to them.
   */
  describe("given the LangWatchQL key on the project", () => {
    it.each([
      ["a caller who can change the project", () => updaterCaller],
      ["a caller who can only view the project", () => viewerCaller],
    ])("withholds it from the payload for %s", async (_label, caller) => {
      const lwqlKey = await projectLangWatchQLKeyFor(caller(), projectId);

      expect(lwqlKey).toBe("");
      expect(lwqlKey).not.toBe(storedLangWatchQLKey);
    });

    /**
     * The control: without it, "the payload does not carry the stored key" is
     * satisfied by a column that was never populated.
     */
    it("has a stored value to withhold", () => {
      expect(storedLangWatchQLKey.length).toBeGreaterThan(0);
    });
  });
});

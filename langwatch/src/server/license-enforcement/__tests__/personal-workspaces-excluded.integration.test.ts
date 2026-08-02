/**
 * @vitest-environment node
 *
 * Personal workspaces must not consume an organization's plan allowance.
 *
 * Every person on the free plan should be able to track their own coding-agent
 * usage, which needs a personal workspace. That workspace cannot spend the
 * projects the customer bought for real work.
 *
 * The enforcement path, the usage page, and the license status panel all read
 * their project and team counts from LicenseEnforcementRepository, so this
 * suite asserts all three agree. A count excluded in one place and included in
 * another is worse than excluding it nowhere, because the number a customer
 * sees stops matching the number that blocks them.
 *
 * Requires: PostgreSQL database (Prisma)
 */
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { FREE_PLAN } from "../../../../ee/licensing/constants";
import type { PlanInfo } from "../../../../ee/licensing/planInfo";
import {
  cleanupTestRows,
  requireAssigned,
} from "../../../test-utils/cleanupTestRows";
import { appRouter } from "../../api/root";
import { createInnerTRPCContext } from "../../api/trpc";
import { globalForApp, resetApp } from "../../app-layer/app";
import { createTestApp } from "../../app-layer/presets";
import {
  type PlanProvider,
  PlanProviderService,
} from "../../app-layer/subscription/plan-provider";
import { prisma } from "../../db";
import { LicenseEnforcementRepository } from "../license-enforcement.repository";
import { LicenseEnforcementService } from "../license-enforcement.service";
import {
  type ITraceUsageService,
  type IUsageUnitResolver,
  UsageStatsService,
} from "../usage-stats.service";

const testNamespace = `personal-limits-${nanoid(8)}`;

/** Real (non-personal) workspaces the fixture creates. */
const REAL_TEAMS = 1;
const REAL_PROJECTS = 2;
/**
 * Personal workspaces the fixture creates, which must stay invisible to limits.
 * One per (organization, user) is all the schema allows, so this mirrors the
 * free plan's two members each tracking their own coding-agent usage.
 */
const PERSONAL_TEAMS = 2;
const PERSONAL_PROJECTS = 2;

describe("given an organization with both personal and real workspaces", () => {
  let organizationId: string;
  let realTeamId: string;
  let userId: string;
  let memberUserIds: string[];
  let repository: LicenseEnforcementRepository;
  let mockGetActivePlan: ReturnType<typeof vi.fn>;

  const freePlanWith = (overrides: Partial<PlanInfo> = {}): PlanInfo => ({
    ...FREE_PLAN,
    overrideAddingLimitations: false,
    ...overrides,
  });

  const enforcementFor = (plan: PlanInfo) =>
    new LicenseEnforcementService(
      repository,
      PlanProviderService.create({
        getActivePlan: vi.fn().mockResolvedValue(plan),
      }),
    );

  const usageStatsFor = (plan: PlanInfo) =>
    new UsageStatsService(
      repository,
      {
        getCurrentMonthCount: vi.fn().mockResolvedValue(0),
        getCurrentMonthCountForDisplay: vi.fn().mockResolvedValue(0),
      } satisfies ITraceUsageService,
      PlanProviderService.create({
        getActivePlan: vi.fn().mockResolvedValue(plan),
      }),
      {
        getResolvedUsageUnit: vi.fn().mockResolvedValue("traces"),
      } satisfies IUsageUnitResolver,
    );

  const createCaller = () =>
    appRouter.createCaller(
      createInnerTRPCContext({
        session: { user: { id: userId }, expires: "1" },
      }),
    );

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "Test Organization", slug: `--test-org-${testNamespace}` },
    });
    organizationId = organization.id;

    memberUserIds = [];
    for (let index = 0; index < PERSONAL_TEAMS; index++) {
      const member = await prisma.user.create({
        data: {
          name: `Test User ${index}`,
          email: `test-${testNamespace}-${index}@example.com`,
        },
      });
      memberUserIds.push(member.id);

      await prisma.organizationUser.create({
        data: {
          userId: member.id,
          organizationId,
          role: OrganizationUserRole.ADMIN,
        },
      });
    }
    userId = memberUserIds[0]!;

    const createTeam = ({
      index,
      isPersonal,
    }: {
      index: number;
      isPersonal: boolean;
    }) =>
      prisma.team.create({
        data: {
          name: isPersonal ? `Personal Team ${index}` : `Team ${index}`,
          slug: `--test-team-${testNamespace}-${isPersonal ? "personal" : "real"}-${index}`,
          organizationId,
          isPersonal,
          ...(isPersonal ? { ownerUserId: memberUserIds[index] } : {}),
        },
      });

    const createProject = ({
      teamId,
      index,
      isPersonal,
    }: {
      teamId: string;
      index: number;
      isPersonal: boolean;
    }) =>
      prisma.project.create({
        data: {
          name: isPersonal ? `Personal Project ${index}` : `Project ${index}`,
          slug: `--test-proj-${testNamespace}-${isPersonal ? "personal" : "real"}-${index}`,
          apiKey: `sk-lw-test-${nanoid()}`,
          teamId,
          language: "en",
          framework: "test",
          isPersonal,
          ...(isPersonal ? { ownerUserId: memberUserIds[index] } : {}),
        },
      });

    const realTeam = await createTeam({ index: 0, isPersonal: false });
    realTeamId = realTeam.id;
    for (let index = 0; index < REAL_PROJECTS; index++) {
      await createProject({ teamId: realTeam.id, index, isPersonal: false });
    }

    // Membership on the real team so the create-project RBAC guard passes.
    await prisma.teamUser.create({
      data: { userId, teamId: realTeam.id, role: TeamUserRole.ADMIN },
    });
    await prisma.roleBinding.create({
      data: {
        userId,
        organizationId,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: realTeam.id,
        role: TeamUserRole.ADMIN,
      },
    });

    for (let index = 0; index < PERSONAL_TEAMS; index++) {
      const personalTeam = await createTeam({ index, isPersonal: true });
      if (index < PERSONAL_PROJECTS) {
        await createProject({
          teamId: personalTeam.id,
          index,
          isPersonal: true,
        });
      }
    }

    repository = new LicenseEnforcementRepository(prisma);
  });

  beforeEach(async () => {
    await resetApp();
    mockGetActivePlan = vi.fn();
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: mockGetActivePlan as PlanProvider["getActivePlan"],
      }),
      usageLimits: {
        notifyResourceLimitReached: vi.fn().mockResolvedValue(undefined),
        checkAndSendWarning: vi.fn().mockResolvedValue(undefined),
      } as any,
    });
  });

  afterEach(async () => {
    await resetApp();
  });

  afterAll(async () => {
    // ProjectSecret's tenancy guard demands literal project ids, so they
    // are collected first, anchored so a broken setup cannot widen the
    // findMany into every project in the database.
    const projectIds = (
      await prisma.project.findMany({
        where: {
          team: {
            organizationId: requireAssigned({
              value: organizationId,
              name: "organizationId",
            }),
          },
        },
        select: { id: true },
      })
    ).map((project) => project.id);
    await cleanupTestRows(prisma, [
      ["projectSecret", { projectId: { in: projectIds } }],
      ["project", { team: { organizationId } }],
      ["roleBinding", { organizationId }],
      ["teamUser", { team: { organizationId } }],
      ["team", { organizationId }],
      ["organizationUser", { organizationId }],
      ["organization", { slug: `--test-org-${testNamespace}` }],
      ["user", { email: { startsWith: `test-${testNamespace}-` } }],
    ]);
  });

  describe("when counting resources for plan enforcement", () => {
    it("excludes personal projects from the project count", async () => {
      await expect(repository.getProjectCount(organizationId)).resolves.toBe(
        REAL_PROJECTS,
      );
    });

    it("excludes personal teams from the team count", async () => {
      await expect(repository.getTeamCount(organizationId)).resolves.toBe(
        REAL_TEAMS,
      );
    });
  });

  describe("when only personal workspaces would push the organization over", () => {
    it("allows another project because personal ones do not count", async () => {
      const service = enforcementFor(
        freePlanWith({ maxProjects: REAL_PROJECTS + PERSONAL_PROJECTS }),
      );

      await expect(
        service.checkLimit(organizationId, "projects"),
      ).resolves.toMatchObject({ allowed: true, current: REAL_PROJECTS });
    });

    it("allows another team because personal ones do not count", async () => {
      const service = enforcementFor(
        freePlanWith({ maxTeams: REAL_TEAMS + PERSONAL_TEAMS }),
      );

      await expect(
        service.checkLimit(organizationId, "teams"),
      ).resolves.toMatchObject({ allowed: true, current: REAL_TEAMS });
    });
  });

  describe("when real projects have already filled the free allowance", () => {
    /** @scenario Real projects still reach the limit alongside personal projects */
    it("still blocks a new project", async () => {
      const service = enforcementFor(
        freePlanWith({ maxProjects: REAL_PROJECTS }),
      );

      await expect(
        service.checkLimit(organizationId, "projects"),
      ).resolves.toMatchObject({
        allowed: false,
        current: REAL_PROJECTS,
        max: REAL_PROJECTS,
      });
    });

    it("rejects project.create with FORBIDDEN", async () => {
      mockGetActivePlan.mockResolvedValue(
        freePlanWith({ maxProjects: REAL_PROJECTS }),
      );

      await expect(
        createCaller().project.create({
          organizationId,
          teamId: realTeamId,
          name: "One Too Many",
          language: "en",
          framework: "test",
        }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "You have reached the maximum number of projects",
      });
    });
  });

  describe("when real teams have already filled the team allowance", () => {
    /** @scenario Real teams still reach the limit alongside personal teams */
    it("still blocks a new team", async () => {
      const service = enforcementFor(freePlanWith({ maxTeams: REAL_TEAMS }));

      await expect(
        service.checkLimit(organizationId, "teams"),
      ).resolves.toMatchObject({
        allowed: false,
        current: REAL_TEAMS,
        max: REAL_TEAMS,
      });
    });
  });

  describe("when the customer looks at the usage page", () => {
    /** @scenario The reported project usage excludes personal projects */
    /** @scenario The reported team usage excludes personal teams */
    it("reports the same counts that enforcement blocks on", async () => {
      const plan = freePlanWith();
      const usage = await usageStatsFor(plan).getUsageStats(organizationId, {
        id: userId,
      });

      expect(usage.projectsCount).toBe(REAL_PROJECTS);
      expect(usage.teamsCount).toBe(REAL_TEAMS);

      const service = enforcementFor(plan);
      const projectLimit = await service.checkLimit(organizationId, "projects");
      const teamLimit = await service.checkLimit(organizationId, "teams");

      expect(projectLimit.current).toBe(usage.projectsCount);
      expect(teamLimit.current).toBe(usage.teamsCount);
    });
  });

  describe("when a project's personal flag disagrees with its team", () => {
    let strandedFlagProjectId: string | undefined;
    let sharedProjectInPersonalTeamId: string | undefined;

    beforeAll(async () => {
      const personalTeam = await prisma.team.findFirstOrThrow({
        where: { organizationId, isPersonal: true },
        select: { id: true },
      });

      // A project flagged personal but sitting in a shared team, and a project
      // not flagged personal sitting in a personal team. Neither is anyone's
      // personal workspace: that takes both flags. The exemption keying on the
      // project row alone is what makes one flipped flag worth an uncounted
      // project, so both shapes have to count.
      const strandedFlagProject = await prisma.project.create({
        data: {
          name: "Personal Flag In A Shared Team",
          slug: `--test-proj-${testNamespace}-stranded-flag`,
          apiKey: `sk-lw-test-${nanoid()}`,
          teamId: realTeamId,
          language: "en",
          framework: "test",
          isPersonal: true,
        },
      });
      strandedFlagProjectId = strandedFlagProject.id;

      const sharedProjectInPersonalTeam = await prisma.project.create({
        data: {
          name: "Shared Project In A Personal Team",
          slug: `--test-proj-${testNamespace}-in-personal-team`,
          apiKey: `sk-lw-test-${nanoid()}`,
          teamId: personalTeam.id,
          language: "en",
          framework: "test",
          isPersonal: false,
        },
      });
      sharedProjectInPersonalTeamId = sharedProjectInPersonalTeam.id;
    });

    afterAll(async () => {
      const ids = [strandedFlagProjectId, sharedProjectInPersonalTeamId].filter(
        (id): id is string => !!id,
      );
      if (ids.length > 0) {
        await prisma.project.deleteMany({ where: { id: { in: ids } } });
      }
    });

    /** @scenario A project counts unless its own flag and its team both call it personal */
    it("counts both, because neither lives in a personal workspace", async () => {
      await expect(repository.getProjectCount(organizationId)).resolves.toBe(
        REAL_PROJECTS + 2,
      );
    });

    /** @scenario A project counts unless its own flag and its team both call it personal */
    it("still leaves the genuine personal projects out", async () => {
      const personalProjects = await prisma.project.count({
        where: { team: { organizationId, isPersonal: true }, isPersonal: true },
      });

      expect(personalProjects).toBe(PERSONAL_PROJECTS);
      await expect(repository.getProjectCount(organizationId)).resolves.toBe(
        REAL_PROJECTS + 2,
      );
    });
  });

  describe("when a real team has been archived", () => {
    let archivedTeamId: string | undefined;

    beforeAll(async () => {
      const archived = await prisma.team.create({
        data: {
          name: "Archived Team",
          slug: `--test-team-${testNamespace}-archived`,
          organizationId,
          archivedAt: new Date(),
        },
      });
      archivedTeamId = archived.id;
    });

    afterAll(async () => {
      if (archivedTeamId) {
        await cleanupTestRows(prisma, [["team", { id: archivedTeamId }]]);
      }
    });

    /** @scenario Archived teams do not count toward the team limit */
    it("leaves it out of the team count, the way an archived project is", async () => {
      await expect(repository.getTeamCount(organizationId)).resolves.toBe(
        REAL_TEAMS,
      );
    });

    /** @scenario Archived teams do not count toward the team limit */
    it("frees the allowance the archived team was holding", async () => {
      const service = enforcementFor(
        freePlanWith({ maxTeams: REAL_TEAMS + 1 }),
      );

      await expect(
        service.checkLimit(organizationId, "teams"),
      ).resolves.toMatchObject({ allowed: true, current: REAL_TEAMS });
    });
  });

  // Runs last: it adds a real project, which shifts the counts the
  // assertions above pin.
  describe("when a free organization still has real allowance left", () => {
    /** @scenario A free organization keeps its full project allowance after provisioning a personal workspace */
    it("creates the project even though personal projects exist", async () => {
      mockGetActivePlan.mockResolvedValue(
        freePlanWith({ maxProjects: REAL_PROJECTS + 1 }),
      );

      const result = await createCaller().project.create({
        organizationId,
        teamId: realTeamId,
        name: "Real Work",
        language: "en",
        framework: "test",
      });

      expect(result).toMatchObject({ success: true });
      await expect(repository.getProjectCount(organizationId)).resolves.toBe(
        REAL_PROJECTS + 1,
      );
    });
  });
});

/**
 * @vitest-environment node
 *
 * A personal workspace is one person's private space inside an organization:
 * one team, one project, one owner, and none of it spends the organization's
 * plan allowance. Three write paths could take that shape apart, and the
 * owner holds the permission each of them checks, so RBAC never stops them.
 *
 * Two things break when the shape goes:
 *
 *   - The plan stops counting what it should. A project is exempt because it
 *     lives in a personal workspace; moving it into a shared team, or moving
 *     a shared project into a personal team, would settle that by flag alone
 *     and hand the organization a project no limit ever sees.
 *   - Provisioning bricks, permanently. The uniqueness of one personal team
 *     per (organization, owner) covers archived rows, while
 *     PersonalWorkspaceService looks the workspace up with `archivedAt: null`
 *     and needs the team to still hold its personal project. Break either and
 *     `ensure()` can neither find the workspace nor create a replacement, so
 *     the owner has no personal workspace in that organization ever again.
 *
 * Every rejection here is therefore asserted twice: the mutation fails, and
 * the state it would have produced is proven absent. The counts come from the
 * real LicenseEnforcementRepository and the recovery check from the real
 * PersonalWorkspaceService, because a guard that rejects while the damage
 * lands anyway would pass a test that only looked at the error.
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

import { PersonalWorkspaceService } from "../../../../../ee/governance/services/personalWorkspace.service";
import { FREE_PLAN } from "../../../../../ee/licensing/constants";
import { globalForApp, resetApp } from "../../../app-layer/app";
import { createTestApp } from "../../../app-layer/presets";
import { PlanProviderService } from "../../../app-layer/subscription/plan-provider";
import { LicenseEnforcementRepository } from "../../../license-enforcement/license-enforcement.repository";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";
import { prisma } from "../../../db";

vi.mock("../../../auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

const ns = `pw-invariants-${nanoid(8)}`;
const ownerEmail = `${ns}-owner@example.com`;
const colleagueEmail = `${ns}-colleague@example.com`;

describe("given a personal workspace beside a shared team in one organization", () => {
  let organizationId: string;
  let ownerUserId: string;
  let colleagueUserId: string;
  let sharedTeamId: string;
  let sharedProjectId: string;
  let personalTeamId: string;
  let personalProjectId: string;
  let personalTeamName: string;

  let repository: LicenseEnforcementRepository;
  let workspaceService: PersonalWorkspaceService;

  const callerAsOwner = () =>
    appRouter.createCaller(
      createInnerTRPCContext({
        session: {
          user: { id: ownerUserId, name: "Workspace Owner", email: ownerEmail },
          expires: "1",
        } as any,
      }),
    );

  /**
   * The workspace as the service would hand it back on the next login. Both
   * the "still there" assertions and the bricking this suite rules out read
   * through here, so they exercise the same lookup the app does.
   */
  const ensureWorkspace = () =>
    workspaceService.ensure({
      userId: ownerUserId,
      organizationId,
      displayName: "Workspace Owner",
      displayEmail: ownerEmail,
    });

  beforeAll(async () => {
    const owner = await prisma.user.create({
      data: { name: "Workspace Owner", email: ownerEmail },
    });
    ownerUserId = owner.id;

    const colleague = await prisma.user.create({
      data: { name: "Colleague", email: colleagueEmail },
    });
    colleagueUserId = colleague.id;

    const organization = await prisma.organization.create({
      data: { name: `ACME ${ns}`, slug: `--test-org-${ns}` },
    });
    organizationId = organization.id;

    for (const userId of [ownerUserId, colleagueUserId]) {
      await prisma.organizationUser.create({
        data: { userId, organizationId, role: OrganizationUserRole.ADMIN },
      });
    }

    const sharedTeam = await prisma.team.create({
      data: {
        name: `ACME ${ns}`,
        slug: `--test-team-${ns}-shared`,
        organizationId,
      },
    });
    sharedTeamId = sharedTeam.id;

    const sharedProject = await prisma.project.create({
      data: {
        name: "ACME App",
        slug: `--test-proj-${ns}-shared`,
        apiKey: `sk-lw-test-${nanoid()}`,
        teamId: sharedTeamId,
        language: "en",
        framework: "test",
      },
    });
    sharedProjectId = sharedProject.id;

    // The owner administers both the organization and the shared team, which
    // is what makes these mutations reach their guards at all: every one of
    // them is behind a permission this user holds.
    await prisma.roleBinding.create({
      data: {
        userId: ownerUserId,
        organizationId,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organizationId,
      },
    });
    await prisma.roleBinding.create({
      data: {
        userId: ownerUserId,
        organizationId,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: sharedTeamId,
      },
    });
    await prisma.teamUser.create({
      data: {
        userId: ownerUserId,
        teamId: sharedTeamId,
        role: TeamUserRole.ADMIN,
      },
    });

    workspaceService = new PersonalWorkspaceService(prisma);
    const workspace = await ensureWorkspace();
    personalTeamId = workspace.team.id;
    personalTeamName = workspace.team.name;
    personalProjectId = workspace.project.id;

    repository = new LicenseEnforcementRepository(prisma);
  });

  afterAll(async () => {
    // A `beforeAll` that threw partway leaves these ids unset, and Prisma
    // drops an `undefined` from a where clause rather than matching nothing:
    // `deleteMany({ where: { organizationId: undefined } })` is
    // `deleteMany({})`, which empties the table. This database is shared with
    // every other suite and worktree, so a broken setup must not escalate
    // into a destructive teardown. Delete only what was created, and let a
    // real cleanup failure surface rather than swallowing it.
    if (organizationId) {
      const teams = await prisma.team.findMany({
        where: { organizationId },
        select: { id: true },
      });
      const teamIds = teams.map((team) => team.id);

      if (teamIds.length > 0) {
        const projects = await prisma.project.findMany({
          where: { teamId: { in: teamIds } },
          select: { id: true },
        });
        const projectIds = projects.map((project) => project.id);
        if (projectIds.length > 0) {
          await prisma.projectSecret.deleteMany({
            where: { projectId: { in: projectIds } },
          });
        }
        await prisma.project.deleteMany({ where: { teamId: { in: teamIds } } });
        await prisma.teamUser.deleteMany({
          where: { teamId: { in: teamIds } },
        });
      }

      await prisma.roleBinding.deleteMany({ where: { organizationId } });
      await prisma.organizationUser.deleteMany({ where: { organizationId } });
      await prisma.team.deleteMany({ where: { organizationId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }

    const userIds = [ownerUserId, colleagueUserId].filter(Boolean);
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });

  describe("when the owner moves the personal project into the shared team", () => {
    /** @scenario Moving a personal project into a shared team is refused */
    it("refuses the move", async () => {
      await expect(
        callerAsOwner().project.update({
          projectId: personalProjectId,
          teamId: sharedTeamId,
        }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringContaining(
          "Personal workspace projects cannot be moved",
        ),
      });
    });

    /** @scenario Moving a personal project into a shared team is refused */
    it("leaves the project in the personal team", async () => {
      await expect(
        callerAsOwner().project.update({
          projectId: personalProjectId,
          teamId: sharedTeamId,
        }),
      ).rejects.toThrow();

      const project = await prisma.project.findUnique({
        where: { id: personalProjectId },
        select: { teamId: true, isPersonal: true },
      });
      expect(project).toMatchObject({
        teamId: personalTeamId,
        isPersonal: true,
      });
    });

    /** @scenario Moving a personal project into a shared team is refused */
    it("does not hand the organization a project the plan stops counting", async () => {
      const before = await repository.getProjectCount(organizationId);

      await expect(
        callerAsOwner().project.update({
          projectId: personalProjectId,
          teamId: sharedTeamId,
        }),
      ).rejects.toThrow();

      await expect(repository.getProjectCount(organizationId)).resolves.toBe(
        before,
      );
    });

    /** @scenario Moving a personal project into a shared team is refused */
    it("leaves the owner's workspace where the next login finds it", async () => {
      await expect(
        callerAsOwner().project.update({
          projectId: personalProjectId,
          teamId: sharedTeamId,
        }),
      ).rejects.toThrow();

      await expect(ensureWorkspace()).resolves.toMatchObject({
        created: false,
        team: { id: personalTeamId },
        project: { id: personalProjectId },
      });
    });
  });

  describe("when the owner moves a shared project into the personal team", () => {
    /** @scenario Moving a real project into a personal workspace is refused */
    it("refuses the move", async () => {
      await expect(
        callerAsOwner().project.update({
          projectId: sharedProjectId,
          teamId: personalTeamId,
        }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringContaining(
          "cannot be moved into a personal workspace",
        ),
      });
    });

    /** @scenario Moving a real project into a personal workspace is refused */
    it("leaves the project in the shared team, still counted", async () => {
      const before = await repository.getProjectCount(organizationId);

      await expect(
        callerAsOwner().project.update({
          projectId: sharedProjectId,
          teamId: personalTeamId,
        }),
      ).rejects.toThrow();

      const project = await prisma.project.findUnique({
        where: { id: sharedProjectId },
        select: { teamId: true },
      });
      expect(project?.teamId).toBe(sharedTeamId);
      await expect(repository.getProjectCount(organizationId)).resolves.toBe(
        before,
      );
    });
  });

  describe("when the owner adds a colleague to the personal team", () => {
    const membersWithColleague = () => [
      { userId: ownerUserId, role: TeamUserRole.ADMIN },
      { userId: colleagueUserId, role: TeamUserRole.MEMBER },
    ];

    /** @scenario Adding a member to a personal team is refused */
    it("refuses the membership change", async () => {
      await expect(
        callerAsOwner().team.update({
          teamId: personalTeamId,
          name: personalTeamName,
          members: membersWithColleague(),
        }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringContaining("exactly one member"),
      });
    });

    /** @scenario Adding a member to a personal team is refused */
    it("leaves the personal team holding its owner alone", async () => {
      await expect(
        callerAsOwner().team.update({
          teamId: personalTeamId,
          name: personalTeamName,
          members: membersWithColleague(),
        }),
      ).rejects.toThrow();

      const bindings = await prisma.roleBinding.findMany({
        where: {
          organizationId,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: personalTeamId,
        },
        select: { userId: true, role: true },
      });
      expect(bindings).toEqual([
        { userId: ownerUserId, role: TeamUserRole.ADMIN },
      ]);
    });

    /** @scenario Adding a member to a personal team is refused */
    it("does not leave a shared team the plan stops counting", async () => {
      const before = await repository.getTeamCount(organizationId);

      await expect(
        callerAsOwner().team.update({
          teamId: personalTeamId,
          name: personalTeamName,
          members: membersWithColleague(),
        }),
      ).rejects.toThrow();

      await expect(repository.getTeamCount(organizationId)).resolves.toBe(
        before,
      );
    });

    /** @scenario Renaming a personal team is still allowed */
    it("still lets the owner rename their own workspace", async () => {
      const renamed = `${personalTeamName} (renamed)`;

      await expect(
        callerAsOwner().team.update({
          teamId: personalTeamId,
          name: renamed,
          members: [{ userId: ownerUserId, role: TeamUserRole.ADMIN }],
        }),
      ).resolves.toMatchObject({ success: true });

      const team = await prisma.team.findUnique({
        where: { id: personalTeamId },
        select: { name: true },
      });
      expect(team?.name).toBe(renamed);

      await callerAsOwner().team.update({
        teamId: personalTeamId,
        name: personalTeamName,
        members: [],
      });
      await expect(ensureWorkspace()).resolves.toMatchObject({
        created: false,
        team: { id: personalTeamId },
      });
    });
  });

  describe("when the owner creates a second project in their personal team", () => {
    // Plan limits are wired generously on purpose. Without them the creation
    // would fail for want of an app rather than for the reason under test,
    // and the assertion that no project appeared would pass even with the
    // guard removed.
    beforeEach(async () => {
      await resetApp();
      globalForApp.__langwatch_app = createTestApp({
        planProvider: PlanProviderService.create({
          getActivePlan: vi.fn().mockResolvedValue({
            ...FREE_PLAN,
            overrideAddingLimitations: false,
            maxProjects: 100,
          }),
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

    /** @scenario Creating a project in a personal workspace is refused */
    it("refuses the creation", async () => {
      await expect(
        callerAsOwner().project.create({
          organizationId,
          teamId: personalTeamId,
          name: "Second Personal Project",
          language: "en",
          framework: "test",
        }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringContaining(
          "cannot be created in a personal workspace",
        ),
      });
    });

    /** @scenario Creating a project in a personal workspace is refused */
    it("leaves the workspace holding exactly its one project", async () => {
      await expect(
        callerAsOwner().project.create({
          organizationId,
          teamId: personalTeamId,
          name: "Second Personal Project",
          language: "en",
          framework: "test",
        }),
      ).rejects.toThrow();

      const projects = await prisma.project.findMany({
        where: { teamId: personalTeamId, archivedAt: null },
        select: { id: true },
      });
      expect(projects).toEqual([{ id: personalProjectId }]);
    });
  });

  describe("when the owner archives the personal project", () => {
    /** @scenario Archiving a personal project is refused */
    it("refuses the archival", async () => {
      await expect(
        callerAsOwner().project.archiveById({
          projectId: sharedProjectId,
          projectToArchiveId: personalProjectId,
        }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringContaining("cannot be archived"),
      });
    });

    /** @scenario Archiving a personal project is refused */
    it("leaves the workspace where the next login finds it", async () => {
      await expect(
        callerAsOwner().project.archiveById({
          projectId: sharedProjectId,
          projectToArchiveId: personalProjectId,
        }),
      ).rejects.toThrow();

      const project = await prisma.project.findUnique({
        where: { id: personalProjectId },
        select: { archivedAt: true },
      });
      expect(project?.archivedAt).toBeNull();

      await expect(ensureWorkspace()).resolves.toMatchObject({
        created: false,
        project: { id: personalProjectId },
      });
    });
  });

  describe("when the owner archives the personal team", () => {
    /** @scenario Archiving a personal team is refused */
    it("refuses the archival", async () => {
      await expect(
        callerAsOwner().team.archiveById({ teamId: personalTeamId }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringContaining("cannot be archived"),
      });
    });

    /** @scenario Archiving a personal team is refused */
    it("leaves the team unarchived", async () => {
      await expect(
        callerAsOwner().team.archiveById({ teamId: personalTeamId }),
      ).rejects.toThrow();

      const team = await prisma.team.findUnique({
        where: { id: personalTeamId },
        select: { archivedAt: true },
      });
      expect(team?.archivedAt).toBeNull();
    });

    /** @scenario Archiving a personal team is refused */
    it("leaves provisioning able to find the workspace it would have orphaned", async () => {
      await expect(
        callerAsOwner().team.archiveById({ teamId: personalTeamId }),
      ).rejects.toThrow();

      await expect(ensureWorkspace()).resolves.toMatchObject({
        created: false,
        team: { id: personalTeamId },
        project: { id: personalProjectId },
      });
    });
  });

  // Runs last: it archives a team, which moves the team count the assertions
  // above pin.
  describe("when the owner archives a shared team", () => {
    it("archives it, because only personal teams are held back", async () => {
      const disposable = await prisma.team.create({
        data: {
          name: `Disposable ${ns}`,
          slug: `--test-team-${ns}-disposable`,
          organizationId,
        },
      });

      await expect(
        callerAsOwner().team.archiveById({ teamId: disposable.id }),
      ).resolves.toMatchObject({ success: true });

      const team = await prisma.team.findUnique({
        where: { id: disposable.id },
        select: { archivedAt: true },
      });
      expect(team?.archivedAt).toBeInstanceOf(Date);
    });
  });
});

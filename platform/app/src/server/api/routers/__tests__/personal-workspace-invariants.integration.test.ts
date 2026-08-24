/**
 * @vitest-environment node
 *
 * A personal workspace is one person's private space inside an organization:
 * one team, one project, one owner. Three write paths could take that shape
 * apart, and the owner holds the permission each of them checks, so RBAC
 * never stops them.
 *
 * Two things break when the shape goes:
 *
 *   - The two personal flags stop agreeing. `Project.isPersonal` mirrors
 *     `Team.isPersonal`, and a project lives in a personal workspace only
 *     when both say so; moving a project across that boundary would leave
 *     the pair contradicting itself, which is a shape no reader handles.
 *   - Provisioning bricks, permanently. The uniqueness of one personal team
 *     per (organization, owner) covers archived rows, while
 *     PersonalWorkspaceService looks the workspace up with `archivedAt: null`
 *     and needs the team to still hold its personal project. Break either and
 *     `ensure()` can neither find the workspace nor create a replacement, so
 *     the owner has no personal workspace in that organization ever again.
 *
 * Every rejection here is therefore asserted twice: the mutation fails, and
 * the state it would have produced is proven absent. The recovery check runs
 * against the real PersonalWorkspaceService, because a guard that rejects
 * while the damage lands anyway would pass a test that only looked at the
 * error.
 *
 * One fixture serves every case, so its state and the body of each `when`
 * live at module scope and the suite below reads as the list of write paths
 * the invariant has to survive.
 *
 * Requires: PostgreSQL database (Prisma)
 */

import { generate } from "@langwatch/ksuid";
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
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { KSUID_RESOURCES } from "~/utils/constants";
import { PersonalWorkspaceService } from "../../../../../ee/governance/services/personalWorkspace.service";
import { FREE_PLAN } from "@langwatch/enterprise-licensing-contract";
import { cleanupTestRows } from "../../../../test-utils/cleanupTestRows";
import { wireDefaultTestApp } from "../../../../test-utils/wireDefaultTestApp";
import { globalForApp, resetApp } from "../../../app-layer/app";
import { OrganizationService } from "../../../app-layer/organizations/organization.service";
import { PrismaOrganizationRepository } from "../../../app-layer/organizations/repositories/organization.prisma.repository";
import { createTestApp } from "../../../app-layer/presets";
import { PlanProviderService } from "../../../app-layer/subscription/plan-provider";
import { prisma } from "../../../db";
import { PromptTagRepository } from "../../../prompt-config/repositories/prompt-tag.repository";
import { hasProjectPermission } from "../../rbac";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

wireDefaultTestApp();

vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

const ns = `pw-invariants-${nanoid(8)}`;
const ownerEmail = `${ns}-owner@example.com`;
const colleagueEmail = `${ns}-colleague@example.com`;

let organizationId: string;
let ownerUserId: string;
let colleagueUserId: string;
/** Set by the seat-decision block; read by the shared teardown. */
let seatUserIdForCleanup: string | undefined;
let sharedTeamId: string;
let sharedProjectId: string;
let personalTeamId: string;
let personalProjectId: string;
let personalTeamName: string;

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

const personalTeamScope = () => ({
  scopeType: RoleBindingScopeType.TEAM,
  scopeId: personalTeamId,
});

const ownerBindingsOnPersonalTeam = () =>
  prisma.roleBinding.findMany({
    where: {
      organizationId,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: personalTeamId,
    },
    select: { userId: true, role: true },
  });

async function createFixture(): Promise<void> {
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
}

/**
 * Delete the rows the fixture created, and nothing else.
 *
 * A `beforeAll` that threw partway leaves these ids unset, and Prisma drops an
 * `undefined` from a where clause rather than matching nothing:
 * `deleteMany({ where: { organizationId: undefined } })` is `deleteMany({})`,
 * which empties the table. This database is shared with every other suite and
 * worktree, so a broken setup must not escalate into a destructive teardown.
 * A real cleanup failure is left to surface rather than swallowed.
 */
async function deleteTeamOwnedRows(organizationId: string): Promise<void> {
  const teams = await prisma.team.findMany({
    where: { organizationId },
    select: { id: true },
  });
  const teamIds = teams.map((team) => team.id);
  if (teamIds.length === 0) return;

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
  await prisma.teamUser.deleteMany({ where: { teamId: { in: teamIds } } });
}

async function deleteFixture({
  organizationId,
  userIds,
}: {
  organizationId?: string;
  userIds: (string | undefined)[];
}): Promise<void> {
  if (organizationId) {
    await deleteTeamOwnedRows(organizationId);
    await cleanupTestRows(prisma, [
      ["roleBinding", { organizationId }],
      ["organizationUser", { organizationId }],
      ["team", { organizationId }],
      ["organization", { id: organizationId }],
    ]);
  }

  const created = userIds.filter((id): id is string => !!id);
  if (created.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: created } } });
  }
}

function movingThePersonalProjectIntoTheSharedTeam() {
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
  it("leaves the project's own flag agreeing with its team's", async () => {
    await expect(
      callerAsOwner().project.update({
        projectId: personalProjectId,
        teamId: sharedTeamId,
      }),
    ).rejects.toThrow();

    // `Project.isPersonal` is a denormalized mirror of `Team.isPersonal`, and
    // a half-applied move is what leaves the two disagreeing. Nothing reads
    // the pair to decide the shape of the workspace unless they agree, so a
    // disagreement is the corruption this refusal exists to prevent.
    const project = await prisma.project.findUnique({
      where: { id: personalProjectId },
      select: { isPersonal: true, team: { select: { isPersonal: true } } },
    });
    expect(project).toMatchObject({
      isPersonal: true,
      team: { isPersonal: true },
    });
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
}

function movingASharedProjectIntoThePersonalTeam() {
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
  it("leaves the project in the shared team, still shared", async () => {
    await expect(
      callerAsOwner().project.update({
        projectId: sharedProjectId,
        teamId: personalTeamId,
      }),
    ).rejects.toThrow();

    const project = await prisma.project.findUnique({
      where: { id: sharedProjectId },
      select: { teamId: true, isPersonal: true },
    });
    expect(project).toMatchObject({
      teamId: sharedTeamId,
      isPersonal: false,
    });
  });
}

function addingAColleagueToThePersonalTeam() {
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

    await expect(ownerBindingsOnPersonalTeam()).resolves.toEqual([
      { userId: ownerUserId, role: TeamUserRole.ADMIN },
    ]);
  });

  /** @scenario Adding a member to a personal team is refused */
  it("does not turn the workspace into an ordinary shared team", async () => {
    await expect(
      callerAsOwner().team.update({
        teamId: personalTeamId,
        name: personalTeamName,
        members: membersWithColleague(),
      }),
    ).rejects.toThrow();

    await expect(
      prisma.team.findUnique({
        where: { id: personalTeamId },
        select: { isPersonal: true },
      }),
    ).resolves.toMatchObject({ isPersonal: true });
  });
}

function renamingThePersonalTeam() {
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
}

function grantingAccessToThePersonalTeamAnotherWay() {
  /** @scenario Giving someone else access to a personal workspace is refused */
  it("refuses roleBinding.create for a second user", async () => {
    await expect(
      callerAsOwner().roleBinding.create({
        organizationId,
        userId: colleagueUserId,
        role: TeamUserRole.MEMBER,
        ...personalTeamScope(),
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("exactly one member"),
    });

    await expect(ownerBindingsOnPersonalTeam()).resolves.toEqual([
      { userId: ownerUserId, role: TeamUserRole.ADMIN },
    ]);
  });

  /** @scenario Giving a group access to a personal workspace is refused */
  it("refuses group.addBinding, which would make it multi-member by proxy", async () => {
    const group = await prisma.group.create({
      data: {
        id: generate(KSUID_RESOURCES.GROUP).toString(),
        organizationId,
        name: `Everyone ${ns}`,
        slug: `--everyone-${ns}`,
      },
    });

    await expect(
      callerAsOwner().group.addBinding({
        organizationId,
        groupId: group.id,
        role: TeamUserRole.ADMIN,
        ...personalTeamScope(),
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("exactly one member"),
    });

    await expect(ownerBindingsOnPersonalTeam()).resolves.toEqual([
      { userId: ownerUserId, role: TeamUserRole.ADMIN },
    ]);
  });

  /** @scenario Giving someone else access to a personal workspace is refused */
  it("refuses a binding that names the personal project instead of the team", async () => {
    await expect(
      callerAsOwner().roleBinding.create({
        organizationId,
        userId: colleagueUserId,
        role: TeamUserRole.MEMBER,
        scopeType: RoleBindingScopeType.PROJECT,
        scopeId: personalProjectId,
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("exactly one member"),
    });

    const projectBindings = await prisma.roleBinding.findMany({
      where: {
        organizationId,
        scopeType: RoleBindingScopeType.PROJECT,
        scopeId: personalProjectId,
      },
      select: { id: true },
    });
    expect(projectBindings).toEqual([]);
  });
}

function takingTheOwnersAccessToTheirWorkspaceAway() {
  /** @scenario Taking the owner's access to their own workspace away is refused */
  it("refuses roleBinding.delete on the owner's own binding", async () => {
    const binding = await prisma.roleBinding.findFirstOrThrow({
      where: {
        organizationId,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: personalTeamId,
        userId: ownerUserId,
      },
      select: { id: true },
    });

    await expect(
      callerAsOwner().roleBinding.delete({
        organizationId,
        bindingId: binding.id,
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("exactly one member"),
    });

    await expect(ownerBindingsOnPersonalTeam()).resolves.toEqual([
      { userId: ownerUserId, role: TeamUserRole.ADMIN },
    ]);
  });

  /** @scenario Changing the owner's role on their own workspace is refused */
  it("refuses organization.updateTeamMemberRole demoting the owner", async () => {
    await expect(
      callerAsOwner().organization.updateTeamMemberRole({
        teamId: personalTeamId,
        userId: ownerUserId,
        role: TeamUserRole.VIEWER,
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      // The code, not the sentence: the sentence is copy, and it is the code
      // the client keys the refusal's copy off once this crosses the wire.
      cause: { code: "personal_workspace_not_managed_here" },
    });

    await expect(ownerBindingsOnPersonalTeam()).resolves.toEqual([
      { userId: ownerUserId, role: TeamUserRole.ADMIN },
    ]);
  });

  /** @scenario Refusing a change to a personal workspace says whose workspace it is */
  it("names the workspace so an admin knows whose it is", async () => {
    const error = await callerAsOwner()
      .organization.updateTeamMemberRole({
        teamId: personalTeamId,
        userId: ownerUserId,
        role: TeamUserRole.VIEWER,
      })
      .catch((e) => e);

    expect(error.cause).toMatchObject({
      code: "personal_workspace_not_managed_here",
      meta: { ownerName: personalTeamName },
    });
  });

  /** @scenario Taking the owner's access to their own workspace away is refused */
  it("leaves the workspace resolvable after every refusal", async () => {
    await expect(ensureWorkspace()).resolves.toMatchObject({
      created: false,
      team: { id: personalTeamId },
      project: { id: personalProjectId },
    });
  });
}

function creatingASecondProjectInThePersonalTeam() {
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
}

function archivingThePersonalProject() {
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
}

function archivingThePersonalTeam() {
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
}

/**
 * The seat decision, which is the one thing here that has to *succeed*.
 *
 * Every other block in this suite proves a refusal. This one proves the
 * refusals stay out of the way of an organization-level decision about a person:
 * an admin working down the member list to fit their plan moves somebody to a
 * Lite Member seat, and the workspace provisioned for that member has no say in
 * it. It used to: the downgrade swept the personal team into its
 * everything-becomes-Viewer correction, tripped the last-admin guard on a team
 * whose only admin is its owner, and rolled the whole transaction back, so the
 * organization role never changed either.
 *
 * A separate member from the rest of the fixture, because this block changes
 * their role and reads it back.
 */
function movingAMemberWithAPersonalWorkspaceToALiteSeat() {
  const seatUserEmail = `${ns}-seat@example.com`;
  let seatUserId: string;
  let seatPersonalTeamId: string;
  let seatPersonalProjectId: string;

  const rbacCtxForSeatUser = () => ({
    prisma,
    session: {
      user: { id: seatUserId, name: "Seat User", email: seatUserEmail },
      expires: "1",
    } as any,
  });

  const orgRoleOfSeatUser = async () =>
    (
      await prisma.organizationUser.findUniqueOrThrow({
        where: {
          userId_organizationId: { userId: seatUserId, organizationId },
        },
        select: { role: true },
      })
    ).role;

  const teamBindingRoles = async (teamId: string) =>
    (
      await prisma.roleBinding.findMany({
        where: {
          organizationId,
          userId: seatUserId,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: teamId,
        },
        select: { role: true },
      })
    ).map((binding) => binding.role);

  const setSeatUserOrganizationRole = (role: OrganizationUserRole) =>
    callerAsOwner().organization.updateMemberRole({
      organizationId,
      userId: seatUserId,
      role,
    });

  beforeAll(async () => {
    const seatUser = await prisma.user.create({
      data: { name: "Seat User", email: seatUserEmail },
    });
    seatUserId = seatUser.id;
    seatUserIdForCleanup = seatUser.id;

    await prisma.organizationUser.create({
      data: {
        userId: seatUserId,
        organizationId,
        role: OrganizationUserRole.MEMBER,
      },
    });
    // Admin of the team the organization shares, which is the binding the
    // downgrade is supposed to correct. The fixture owner is an admin of it too,
    // so correcting this one does not strand the team without an admin.
    await prisma.roleBinding.create({
      data: {
        userId: seatUserId,
        organizationId,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: sharedTeamId,
      },
    });

    const workspace = await workspaceService.ensure({
      userId: seatUserId,
      organizationId,
      displayName: "Seat User",
      displayEmail: seatUserEmail,
    });
    seatPersonalTeamId = workspace.team.id;
    seatPersonalProjectId = workspace.project.id;
  });

  // A plan with Lite Member seats to give away. FREE_PLAN allows none, so
  // without this the downgrade is refused for the allowance rather than for
  // anything this block is about.
  //
  // With a REAL organization service against the test database, because
  // `createTestApp` defaults to a NullOrganizationRepository that resolves
  // without writing: every assertion here is about what the role change left
  // behind, and a mutation that quietly no-opped would satisfy all of them.
  beforeEach(async () => {
    await resetApp();
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: vi.fn().mockResolvedValue({
          ...FREE_PLAN,
          overrideAddingLimitations: false,
          maxMembers: 100,
          maxMembersLite: 100,
        }),
      }),
      organizations: new OrganizationService(
        new PrismaOrganizationRepository(prisma),
        new PromptTagRepository(prisma),
      ),
      usageLimits: {
        notifyResourceLimitReached: vi.fn().mockResolvedValue(undefined),
        checkAndSendWarning: vi.fn().mockResolvedValue(undefined),
      } as any,
    });
  });

  // Put the seat user back the way `beforeAll` left them, by writing the rows
  // rather than replaying the router: teardown that depends on the app a test
  // wired up restores nothing once the app is reset, and swallowing that is how
  // it goes unnoticed. The shared-team binding goes back to ADMIN too, or the
  // next test's assertion that the cascade corrected it to VIEWER would hold
  // whether or not the cascade ran.
  afterEach(async () => {
    await resetApp();
    await prisma.organizationUser.update({
      where: { userId_organizationId: { userId: seatUserId, organizationId } },
      data: { role: OrganizationUserRole.MEMBER },
    });
    await prisma.roleBinding.updateMany({
      where: {
        organizationId,
        userId: seatUserId,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: sharedTeamId,
      },
      data: { role: TeamUserRole.ADMIN },
    });
  });

  /** @scenario Moving a member who has a personal workspace to Lite Member succeeds */
  it("changes the organization role", async () => {
    await expect(
      setSeatUserOrganizationRole(OrganizationUserRole.EXTERNAL),
    ).resolves.toMatchObject({ success: true });

    await expect(orgRoleOfSeatUser()).resolves.toBe(
      OrganizationUserRole.EXTERNAL,
    );
  });

  /** @scenario Moving a member who has a personal workspace to Lite Member succeeds */
  it("corrects their role on the shared team to viewer", async () => {
    await setSeatUserOrganizationRole(OrganizationUserRole.EXTERNAL);

    await expect(teamBindingRoles(sharedTeamId)).resolves.toEqual([
      TeamUserRole.VIEWER,
    ]);
  });

  /** @scenario Moving a member who has a personal workspace to Lite Member succeeds */
  it("leaves them the admin of their own workspace", async () => {
    await setSeatUserOrganizationRole(OrganizationUserRole.EXTERNAL);

    await expect(teamBindingRoles(seatPersonalTeamId)).resolves.toEqual([
      TeamUserRole.ADMIN,
    ]);
  });

  /** @scenario Moving a member who has a personal workspace to Lite Member succeeds */
  it("leaves the workspace where their next login finds it", async () => {
    await setSeatUserOrganizationRole(OrganizationUserRole.EXTERNAL);

    await expect(
      workspaceService.ensure({
        userId: seatUserId,
        organizationId,
        displayName: "Seat User",
        displayEmail: seatUserEmail,
      }),
    ).resolves.toMatchObject({
      created: false,
      team: { id: seatPersonalTeamId },
      project: { id: seatPersonalProjectId },
    });
  });

  // Why leaving that admin binding alone is safe, and the assertion the whole
  // design rests on. A member's organization role caps what any non-custom
  // binding of theirs can do (`resolveBindingPermission`), so the cap does the
  // restricting and the binding is free to stay what it is. Nothing asserted
  // this before, and `rbac.ts` names retiring that cap as future work.

  /** @scenario A Lite Member reads their own personal workspace but cannot write to it */
  it("still lets them read their own workspace", async () => {
    await setSeatUserOrganizationRole(OrganizationUserRole.EXTERNAL);

    await expect(
      hasProjectPermission(
        rbacCtxForSeatUser(),
        seatPersonalProjectId,
        "datasets:view",
      ),
    ).resolves.toBe(true);
  });

  /** @scenario A Lite Member reads their own personal workspace but cannot write to it */
  it("stops them writing to it, admin binding and all", async () => {
    await setSeatUserOrganizationRole(OrganizationUserRole.EXTERNAL);

    await expect(
      hasProjectPermission(
        rbacCtxForSeatUser(),
        seatPersonalProjectId,
        "datasets:create",
      ),
    ).resolves.toBe(false);
  });

  /** @scenario Giving a Lite Member their full access back restores writing in their own workspace */
  it("lets them write again once they are a member, with nothing to repair", async () => {
    await setSeatUserOrganizationRole(OrganizationUserRole.EXTERNAL);
    await setSeatUserOrganizationRole(OrganizationUserRole.MEMBER);

    await expect(
      hasProjectPermission(
        rbacCtxForSeatUser(),
        seatPersonalProjectId,
        "datasets:create",
      ),
    ).resolves.toBe(true);
  });

  /** @scenario A personal workspace is not listed among the access an admin manages */
  it("keeps the workspace out of the access an admin is shown for them", async () => {
    const bindings = await callerAsOwner().roleBinding.listForUser({
      organizationId,
      userId: seatUserId,
    });

    expect(bindings.map((binding) => binding.scopeId)).not.toContain(
      seatPersonalTeamId,
    );
    // The shared team is still there: this hides what cannot be managed, not
    // everything about the member.
    expect(bindings.map((binding) => binding.scopeId)).toContain(sharedTeamId);
  });

  /** @scenario A personal workspace is not listed among the access an admin manages */
  it("keeps every member's workspace out of the organization-wide list", async () => {
    const bindings = await callerAsOwner().roleBinding.listForOrg({
      organizationId,
    });

    expect(bindings.map((binding) => binding.scopeId)).not.toContain(
      seatPersonalTeamId,
    );
    expect(bindings.map((binding) => binding.scopeId)).not.toContain(
      personalTeamId,
    );
  });
}

function archivingASharedTeam() {
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
}

describe("given a personal workspace beside a shared team in one organization", () => {
  beforeAll(createFixture);

  afterAll(async () => {
    await deleteFixture({
      organizationId,
      userIds: [ownerUserId, colleagueUserId, seatUserIdForCleanup],
    });
  });

  describe(
    "when the owner moves the personal project into the shared team",
    movingThePersonalProjectIntoTheSharedTeam,
  );
  describe(
    "when the owner moves a shared project into the personal team",
    movingASharedProjectIntoThePersonalTeam,
  );
  describe(
    "when the owner adds a colleague to the personal team",
    addingAColleagueToThePersonalTeam,
  );
  describe("when the owner renames the personal team", renamingThePersonalTeam);

  // Role bindings are the general form of "who reaches this team". The team
  // editor is one caller of many, so the invariant has to hold on the generic
  // paths too, or an organization manager can grant access to a personal team
  // without the editor's guard ever running.
  describe(
    "when a manager grants access to the personal team another way",
    grantingAccessToThePersonalTeamAnotherWay,
  );
  describe(
    "when a manager takes the owner's own access away",
    takingTheOwnersAccessToTheirWorkspaceAway,
  );

  describe(
    "when the owner creates a second project in their personal team",
    creatingASecondProjectInThePersonalTeam,
  );
  describe(
    "when the owner archives the personal project",
    archivingThePersonalProject,
  );
  describe(
    "when the owner archives the personal team",
    archivingThePersonalTeam,
  );

  // The one decision that has to go through rather than be refused.
  describe(
    "when an admin moves a member who has a personal workspace to a Lite Member seat",
    movingAMemberWithAPersonalWorkspaceToALiteSeat,
  );

  // Runs last: it archives a team, which moves the team count the assertions
  // above pin.
  describe("when the owner archives a shared team", archivingASharedTeam);
});

/**
 * @vitest-environment node
 *
 * Integration coverage for the #47 RBAC privacy backstop. Hits real
 * Postgres via the tRPC layer with two distinct caller sessions (admin
 * + member) so the permission middleware actually fires.
 *
 * Pins three invariants:
 *
 *   1. Admin-surface tRPC procedures (the 5 bumped from organization:view
 *      to organization:manage in eadd6e38f) UNAUTHORIZED for MEMBER.
 *      Direct curl with a member session cookie now returns nothing.
 *
 *   2. Picker procedures (organization.getOrganizationWithMembersAndTheirTeams,
 *      team.getTeamsWithMembers, team.getTeamWithMembers) succeed for
 *      MEMBER but null other members' .email while preserving the caller's
 *      own email. Names + ids stay (picker UX is unchanged).
 *
 *   3. Personal-workspace teams owned by other users are stripped from
 *      picker results when the caller isn't admin. Caller's own personal
 *      workspace remains visible.
 *
 * Companion to the four shipped commits: bca6e0422 (UI gates),
 * eadd6e38f (admin-surface tightening), fb8f3e8b8 (email redaction),
 * 4162531ff (personal-workspace strip).
 */
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "../../../db";
import { createTestApp } from "../../../app-layer/presets";
import { globalForApp, resetApp } from "../../../app-layer/app";
import { PlanProviderService } from "../../../app-layer/subscription/plan-provider";
import { OrganizationService } from "../../../app-layer/organizations/organization.service";
import { PrismaOrganizationRepository } from "../../../app-layer/organizations/repositories/organization.prisma.repository";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

const { mockGetActivePlan } = vi.hoisted(() => ({
  mockGetActivePlan: vi.fn(),
}));

const ns = nanoid(8);
const ORG_ID = `org-rbac-leak-${ns}`;
const REGULAR_TEAM_ID = `team-rbac-leak-${ns}`;
const ADMIN_USER_ID = `usr-admin-${ns}`;
const MEMBER_USER_ID = `usr-member-${ns}`;
const ADMIN_PERSONAL_TEAM_ID = `team-admin-personal-${ns}`;
const MEMBER_PERSONAL_TEAM_ID = `team-member-personal-${ns}`;
const GROUP_ID = `group-rbac-leak-${ns}`;

const ADMIN_EMAIL = `admin-${ns}@rbac-leak.test`;
const MEMBER_EMAIL = `member-${ns}@rbac-leak.test`;

describe("#47 RBAC member-leak coverage (integration)", () => {
  let adminCaller: ReturnType<typeof appRouter.createCaller>;
  let memberCaller: ReturnType<typeof appRouter.createCaller>;
  let regularTeamSlug: string;
  let adminPersonalSlug: string;
  let memberPersonalSlug: string;

  beforeAll(async () => {
    // Wire the App singleton — procedures that touch
    // `getApp().organizations.*` (getOrganizationWithMembersAndTheirTeams)
    // or `assertEnterprisePlan` (the group router) require a live App.
    // Same pattern as organization.invites.integration.test.ts (#3240
    // workaround) — bypass initializeDefaultApp() which has a require()
    // chain that fails under vitest, and instead build a test App with
    // (a) a real Prisma org repo so picker procedures resolve fixtures,
    // (b) an ENTERPRISE plan provider so group.* assertEnterprisePlan
    // doesn't 402 the admin happy-path tests.
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
        // OrganizationService needs a PromptTagRepository but it's not
        // exercised by our tests — null-stub satisfies the constructor.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { seedForOrg: async () => { } } as any,
      ),
      planProvider: PlanProviderService.create({
        getActivePlan: mockGetActivePlan,
      }),
    });

    // Org + 2 users + 1 regular team + 2 personal-workspace teams.
    await prisma.organization.create({
      data: { id: ORG_ID, name: `RBAC Leak Org ${ns}`, slug: `rbac-leak-${ns}` },
    });

    await prisma.user.create({
      data: { id: ADMIN_USER_ID, email: ADMIN_EMAIL, name: "Admin User" },
    });
    await prisma.user.create({
      data: { id: MEMBER_USER_ID, email: MEMBER_EMAIL, name: "Member User" },
    });

    await prisma.organizationUser.create({
      data: {
        userId: ADMIN_USER_ID,
        organizationId: ORG_ID,
        role: OrganizationUserRole.ADMIN,
      },
    });
    await prisma.organizationUser.create({
      data: {
        userId: MEMBER_USER_ID,
        organizationId: ORG_ID,
        role: OrganizationUserRole.MEMBER,
      },
    });

    // Org-scoped RoleBindings — admin gets ADMIN, member gets MEMBER.
    // The permission resolver consults bindings first, falls back to
    // the OrganizationUser.role baseline. Both layers say the same
    // thing here, so admin has organization:manage and member doesn't.
    await prisma.roleBinding.create({
      data: {
        id: `rb-admin-${ns}`,
        organizationId: ORG_ID,
        userId: ADMIN_USER_ID,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: ORG_ID,
      },
    });
    await prisma.roleBinding.create({
      data: {
        id: `rb-member-${ns}`,
        organizationId: ORG_ID,
        userId: MEMBER_USER_ID,
        role: TeamUserRole.MEMBER,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: ORG_ID,
      },
    });

    // Regular team — both members are on it. This team should appear
    // in picker results for both callers.
    regularTeamSlug = `rbac-team-${ns}`;
    await prisma.team.create({
      data: {
        id: REGULAR_TEAM_ID,
        name: `Regular Team ${ns}`,
        slug: regularTeamSlug,
        organizationId: ORG_ID,
      },
    });
    await prisma.teamUser.create({
      data: {
        userId: ADMIN_USER_ID,
        teamId: REGULAR_TEAM_ID,
        role: TeamUserRole.ADMIN,
      },
    });
    await prisma.teamUser.create({
      data: {
        userId: MEMBER_USER_ID,
        teamId: REGULAR_TEAM_ID,
        role: TeamUserRole.MEMBER,
      },
    });

    // Admin's personal workspace — admin is sole member; isPersonal=true.
    // Member should NOT see this in picker results.
    adminPersonalSlug = `admin-personal-${ns}`;
    await prisma.team.create({
      data: {
        id: ADMIN_PERSONAL_TEAM_ID,
        name: `Admin Personal ${ns}`,
        slug: adminPersonalSlug,
        organizationId: ORG_ID,
        isPersonal: true,
        ownerUserId: ADMIN_USER_ID,
      },
    });
    await prisma.teamUser.create({
      data: {
        userId: ADMIN_USER_ID,
        teamId: ADMIN_PERSONAL_TEAM_ID,
        role: TeamUserRole.ADMIN,
      },
    });

    // Member's personal workspace — member is sole member.
    memberPersonalSlug = `member-personal-${ns}`;
    await prisma.team.create({
      data: {
        id: MEMBER_PERSONAL_TEAM_ID,
        name: `Member Personal ${ns}`,
        slug: memberPersonalSlug,
        organizationId: ORG_ID,
        isPersonal: true,
        ownerUserId: MEMBER_USER_ID,
      },
    });
    await prisma.teamUser.create({
      data: {
        userId: MEMBER_USER_ID,
        teamId: MEMBER_PERSONAL_TEAM_ID,
        role: TeamUserRole.ADMIN,
      },
    });

    // Group fixture so admin happy-path tests have something to find.
    // Group + 1 admin member; member denial tests don't depend on the
    // group existing because the permission gate fires before the query.
    await prisma.group.create({
      data: {
        id: GROUP_ID,
        organizationId: ORG_ID,
        name: `RBAC Leak Group ${ns}`,
        slug: `rbac-leak-group-${ns}`,
      },
    });
    await prisma.groupMembership.create({
      data: { groupId: GROUP_ID, userId: ADMIN_USER_ID },
    });

    adminCaller = appRouter.createCaller(
      createInnerTRPCContext({
        session: { user: { id: ADMIN_USER_ID }, expires: "1" },
      }),
    );
    memberCaller = appRouter.createCaller(
      createInnerTRPCContext({
        session: { user: { id: MEMBER_USER_ID }, expires: "1" },
      }),
    );
  });

  afterAll(async () => {
    await prisma.groupMembership.deleteMany({ where: { groupId: GROUP_ID } });
    await prisma.group.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.roleBinding.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.teamUser.deleteMany({
      where: {
        teamId: {
          in: [REGULAR_TEAM_ID, ADMIN_PERSONAL_TEAM_ID, MEMBER_PERSONAL_TEAM_ID],
        },
      },
    });
    await prisma.team.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.organizationUser.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [ADMIN_USER_ID, MEMBER_USER_ID] } },
    });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await resetApp();
  });

  // ── 1. Admin-surface procedures deny MEMBER ───────────────────────

  describe("admin-surface procedures (eadd6e38f)", () => {
    it("role.getAll → UNAUTHORIZED for member", async () => {
      await expect(
        memberCaller.role.getAll({ organizationId: ORG_ID }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("organization.getAllOrganizationMembers → UNAUTHORIZED for member", async () => {
      await expect(
        memberCaller.organization.getAllOrganizationMembers({
          organizationId: ORG_ID,
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("organization.getOrganizationPendingInvites → UNAUTHORIZED for member", async () => {
      await expect(
        memberCaller.organization.getOrganizationPendingInvites({
          organizationId: ORG_ID,
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("team.getTeamsWithRoleBindings → UNAUTHORIZED for member", async () => {
      await expect(
        memberCaller.team.getTeamsWithRoleBindings({
          organizationId: ORG_ID,
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("organization.getMemberById → UNAUTHORIZED for member", async () => {
      await expect(
        memberCaller.organization.getMemberById({
          organizationId: ORG_ID,
          userId: ADMIN_USER_ID,
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("admin can call all five procedures successfully", async () => {
      // Sanity: the admin caller does have manage and the procs return
      // data. Confirms the bumps didn't break the admin side.
      await expect(
        adminCaller.role.getAll({ organizationId: ORG_ID }),
      ).resolves.toBeDefined();
      await expect(
        adminCaller.organization.getAllOrganizationMembers({
          organizationId: ORG_ID,
        }),
      ).resolves.toBeDefined();
      await expect(
        adminCaller.organization.getOrganizationPendingInvites({
          organizationId: ORG_ID,
        }),
      ).resolves.toBeDefined();
      await expect(
        adminCaller.team.getTeamsWithRoleBindings({ organizationId: ORG_ID }),
      ).resolves.toBeDefined();
      await expect(
        adminCaller.organization.getMemberById({
          organizationId: ORG_ID,
          userId: MEMBER_USER_ID,
        }),
      ).resolves.toBeDefined();
    });
  });

  // ── 2. Picker email redaction for non-admin (fb8f3e8b8) ──────────

  describe("picker procedures — email redaction (fb8f3e8b8)", () => {
    it("team.getTeamsWithMembers as MEMBER nulls other members' emails, preserves own", async () => {
      const teams = await memberCaller.team.getTeamsWithMembers({
        organizationId: ORG_ID,
      });
      const regular = teams.find((t) => t.id === REGULAR_TEAM_ID);
      expect(regular).toBeDefined();
      const adminMember = regular!.members.find(
        (m) => m.userId === ADMIN_USER_ID,
      );
      const memberMember = regular!.members.find(
        (m) => m.userId === MEMBER_USER_ID,
      );
      expect(adminMember?.user.email).toBeNull();
      expect(memberMember?.user.email).toBe(MEMBER_EMAIL);
      // Names stay visible — picker UX is unaffected.
      expect(adminMember?.user.name).toBe("Admin User");
    });

    it("team.getTeamsWithMembers as ADMIN preserves all emails", async () => {
      const teams = await adminCaller.team.getTeamsWithMembers({
        organizationId: ORG_ID,
      });
      const regular = teams.find((t) => t.id === REGULAR_TEAM_ID);
      expect(regular).toBeDefined();
      const memberMember = regular!.members.find(
        (m) => m.userId === MEMBER_USER_ID,
      );
      expect(memberMember?.user.email).toBe(MEMBER_EMAIL);
    });

    it("team.getTeamWithMembers as MEMBER nulls other members' emails", async () => {
      const team = await memberCaller.team.getTeamWithMembers({
        slug: regularTeamSlug,
        organizationId: ORG_ID,
      });
      const adminMember = team.members.find(
        (m) => m.userId === ADMIN_USER_ID,
      );
      expect(adminMember?.user.email).toBeNull();
    });

    it("organization.getOrganizationWithMembersAndTheirTeams as MEMBER nulls other members' emails", async () => {
      const org = await memberCaller.organization.getOrganizationWithMembersAndTheirTeams(
        { organizationId: ORG_ID },
      );
      const adminEntry = org.members.find((m) => m.user.id === ADMIN_USER_ID);
      const memberEntry = org.members.find((m) => m.user.id === MEMBER_USER_ID);
      expect(adminEntry?.user.email).toBeNull();
      expect(memberEntry?.user.email).toBe(MEMBER_EMAIL);
    });
  });

  // ── 3. Personal-workspace strip (4162531ff) ───────────────────────

  describe("picker procedures — personal-workspace strip (4162531ff)", () => {
    it("team.getTeamsWithMembers as MEMBER excludes other users' personal workspaces", async () => {
      const teams = await memberCaller.team.getTeamsWithMembers({
        organizationId: ORG_ID,
      });
      const ids = teams.map((t) => t.id);
      // Member's own personal workspace stays visible.
      expect(ids).toContain(MEMBER_PERSONAL_TEAM_ID);
      // Admin's personal workspace is hidden from member.
      expect(ids).not.toContain(ADMIN_PERSONAL_TEAM_ID);
      // Regular team is visible to both.
      expect(ids).toContain(REGULAR_TEAM_ID);
    });

    it("team.getTeamsWithMembers as ADMIN sees every team including others' personal workspaces", async () => {
      const teams = await adminCaller.team.getTeamsWithMembers({
        organizationId: ORG_ID,
      });
      const ids = teams.map((t) => t.id);
      expect(ids).toContain(REGULAR_TEAM_ID);
      expect(ids).toContain(ADMIN_PERSONAL_TEAM_ID);
      expect(ids).toContain(MEMBER_PERSONAL_TEAM_ID);
    });

    it("team.getTeamWithMembers as MEMBER probing admin's personal slug → NOT_FOUND", async () => {
      // Probe the admin's personal-workspace slug as the member.
      // Should respond identically to a missing-slug lookup —
      // existence itself is private.
      await expect(
        memberCaller.team.getTeamWithMembers({
          slug: adminPersonalSlug,
          organizationId: ORG_ID,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("team.getTeamWithMembers as MEMBER on own personal slug succeeds", async () => {
      // Caller's own personal workspace stays accessible.
      const own = await memberCaller.team.getTeamWithMembers({
        slug: memberPersonalSlug,
        organizationId: ORG_ID,
      });
      expect(own.id).toBe(MEMBER_PERSONAL_TEAM_ID);
      expect(own.isPersonal).toBe(true);
      expect(own.ownerUserId).toBe(MEMBER_USER_ID);
    });

    it("team.getTeamWithMembers as ADMIN on member's personal slug succeeds (admin sees all)", async () => {
      const team = await adminCaller.team.getTeamWithMembers({
        slug: memberPersonalSlug,
        organizationId: ORG_ID,
      });
      expect(team.id).toBe(MEMBER_PERSONAL_TEAM_ID);
    });
  });

  // ── 4. Group router admin reads (0936a76b8) ───────────────────────

  describe("group router (0936a76b8)", () => {
    it("group.getById → UNAUTHORIZED for member", async () => {
      // Member can't pull the full member roster (which exposes emails)
      // for any group, regardless of whether they're in it.
      await expect(
        memberCaller.group.getById({
          organizationId: ORG_ID,
          groupId: GROUP_ID,
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("group.listForMember → UNAUTHORIZED for member", async () => {
      // Member can't enumerate any user's group memberships — that's
      // admin-surface authz visibility (which role bindings get
      // inherited via group membership).
      await expect(
        memberCaller.group.listForMember({
          organizationId: ORG_ID,
          userId: ADMIN_USER_ID,
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("group.listAll → UNAUTHORIZED for member", async () => {
      // Member can't enumerate every group's role-binding map.
      await expect(
        memberCaller.group.listAll({ organizationId: ORG_ID }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("admin can call all three group procedures successfully", async () => {
      // Sanity: admin still has access. Confirms the bumps didn't
      // break the admin path (and that the seeded group fixture is
      // discoverable via the live router).
      const detail = await adminCaller.group.getById({
        organizationId: ORG_ID,
        groupId: GROUP_ID,
      });
      expect(detail.id).toBe(GROUP_ID);

      const memberGroups = await adminCaller.group.listForMember({
        organizationId: ORG_ID,
        userId: ADMIN_USER_ID,
      });
      expect(memberGroups.map((g) => g.id)).toContain(GROUP_ID);

      const allGroups = await adminCaller.group.listAll({
        organizationId: ORG_ID,
      });
      expect(allGroups.map((g) => g.id)).toContain(GROUP_ID);
    });
  });

  // ── 5. limits.checkAndSendUsageLimitNotification (df6457852) ──────

  describe("limits router (df6457852)", () => {
    it("limits.checkAndSendUsageLimitNotification → UNAUTHORIZED for member", async () => {
      // Mutation takes caller-supplied counts and triggers an admin
      // email. Member calling it directly via tRPC curl is the spam
      // vector — must deny.
      await expect(
        memberCaller.limits.checkAndSendUsageLimitNotification({
          organizationId: ORG_ID,
          currentMonthMessagesCount: 99999,
          maxMonthlyUsageLimit: 100,
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("admin can call limits.checkAndSendUsageLimitNotification", async () => {
      // Sanity: admin reaches the (null-impl) usage-limits service in
      // the test App. The test isn't asserting an email actually got
      // sent — just that the permission gate lets admin through and
      // the procedure returns its declared shape.
      const result = await adminCaller.limits.checkAndSendUsageLimitNotification({
        organizationId: ORG_ID,
        currentMonthMessagesCount: 1,
        maxMonthlyUsageLimit: 100,
      });
      expect(result).toMatchObject({ sent: expect.any(Boolean) });
    });
  });
});

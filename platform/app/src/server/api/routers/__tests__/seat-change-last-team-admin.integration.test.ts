/**
 * @vitest-environment node
 *
 * A seat decision, and the team whose only admin it takes away.
 *
 * Correcting somebody down to a Lite Member seat sets their role in every shared
 * team to Viewer, and the last-admin guard used to refuse that whenever they were
 * a team's only admin. The refusal was raised inside the transaction that also
 * carried the organization role change, so nothing was saved at all: the seat the
 * admin was trying to change stayed exactly as it was, and no amount of editing
 * the member's access first helped, because the seat change is applied before it
 * and always read the roles as they still were.
 *
 * It goes through now. The guard exists so a team is never left with nobody who
 * can administer it, and that is not what this produces: an ORGANIZATION-scoped
 * ADMIN binding grants team permissions in every shared team, which the last case
 * here proves rather than assumes. What the decision changed is reported back, so
 * the admin who made it is not left to discover it.
 *
 * A caller that names the team and the role outright is a team-local decision and
 * still meets the guard, now as a refusal that says which team.
 *
 * Requires: PostgreSQL database (Prisma)
 */

import { generate } from "@langwatch/ksuid";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { KSUID_RESOURCES } from "~/utils/constants";
import { FREE_PLAN } from "../../../../../ee/licensing/constants";
import { cleanupTestRows } from "../../../../test-utils/cleanupTestRows";
import { globalForApp, resetApp } from "../../../app-layer/app";
import { OrganizationService } from "../../../app-layer/organizations/organization.service";
import { PrismaOrganizationRepository } from "../../../app-layer/organizations/repositories/organization.prisma.repository";
import { createTestApp } from "../../../app-layer/presets";
import { PlanProviderService } from "../../../app-layer/subscription/plan-provider";
import { prisma } from "../../../db";
import { PromptTagRepository } from "../../../prompt-config/repositories/prompt-tag.repository";
import { hasTeamPermission } from "../../rbac";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

const ns = `seat-admin-${nanoid(8)}`;
const adminEmail = `${ns}-admin@example.com`;
const soloEmail = `${ns}-solo@example.com`;
const companionEmail = `${ns}-companion@example.com`;

let organizationId: string;
let adminUserId: string;
let soloUserId: string;
let companionUserId: string;
/** Two teams whose only admin is the seat user, and one that has another. */
let onlyAdminTeamId: string;
let alsoOnlyAdminTeamId: string;
let sharedWithAnotherAdminTeamId: string;

const callerAsAdmin = () =>
  appRouter.createCaller(
    createInnerTRPCContext({
      session: {
        user: { id: adminUserId, name: "Org Admin", email: adminEmail },
        expires: "1",
      } as any,
    }),
  );

const createTeam = async (label: string) => {
  const team = await prisma.team.create({
    data: {
      id: generate(KSUID_RESOURCES.TEAM).toString(),
      name: `${label} ${ns}`,
      slug: `${ns}-${label}`,
      organizationId,
    },
  });
  return team.id;
};

const bindTeamRole = ({
  userId,
  teamId,
  role,
}: {
  userId: string;
  teamId: string;
  role: TeamUserRole;
}) =>
  prisma.roleBinding.create({
    data: {
      id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
      organizationId,
      userId,
      role,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: teamId,
    },
  });

const teamRoleOf = async ({
  userId,
  teamId,
}: {
  userId: string;
  teamId: string;
}) =>
  (
    await prisma.roleBinding.findFirst({
      where: {
        organizationId,
        userId,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: teamId,
      },
      select: { role: true },
    })
  )?.role ?? null;

const moveSoloUserTo = (role: OrganizationUserRole) =>
  callerAsAdmin().organization.updateMemberRole({
    organizationId,
    userId: soloUserId,
    role,
  });

describe("given a member who is the only admin of shared teams", () => {
  beforeAll(async () => {
    const [admin, solo, companion] = await Promise.all([
      prisma.user.create({ data: { name: "Org Admin", email: adminEmail } }),
      prisma.user.create({ data: { name: "Solo Admin", email: soloEmail } }),
      prisma.user.create({
        data: { name: "Companion", email: companionEmail },
      }),
    ]);
    adminUserId = admin.id;
    soloUserId = solo.id;
    companionUserId = companion.id;

    const organization = await prisma.organization.create({
      data: { name: `ACME ${ns}`, slug: `--test-org-${ns}` },
    });
    organizationId = organization.id;

    for (const [userId, role] of [
      [adminUserId, OrganizationUserRole.ADMIN],
      [soloUserId, OrganizationUserRole.MEMBER],
      [companionUserId, OrganizationUserRole.MEMBER],
    ] as const) {
      await prisma.organizationUser.create({
        data: { userId, organizationId, role },
      });
    }

    // The organization admin's own org-scoped binding. It is what keeps every
    // shared team administered after a seat correction, so it is fixture state
    // rather than incidental.
    await prisma.roleBinding.create({
      data: {
        id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
        organizationId,
        userId: adminUserId,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organizationId,
      },
    });

    onlyAdminTeamId = await createTeam("solo-one");
    alsoOnlyAdminTeamId = await createTeam("solo-two");
    sharedWithAnotherAdminTeamId = await createTeam("shared");

    await resetApp();
    globalForApp.__langwatch_app = createTestApp({
      // FREE_PLAN gives away no Lite Member seats, so without this the seat
      // change is refused for the allowance rather than for anything this
      // suite is about.
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

  // Every test starts from the same bindings, because the first seat change
  // rewrites them and an assertion that the correction happened would otherwise
  // hold on whatever the previous test left behind.
  beforeEach(async () => {
    await prisma.roleBinding.deleteMany({
      where: {
        organizationId,
        userId: { in: [soloUserId, companionUserId] },
        scopeType: RoleBindingScopeType.TEAM,
      },
    });
    await prisma.organizationUser.update({
      where: {
        userId_organizationId: { userId: soloUserId, organizationId },
      },
      data: { role: OrganizationUserRole.MEMBER },
    });
    for (const teamId of [
      onlyAdminTeamId,
      alsoOnlyAdminTeamId,
      sharedWithAnotherAdminTeamId,
    ]) {
      await bindTeamRole({
        userId: soloUserId,
        teamId,
        role: TeamUserRole.ADMIN,
      });
    }
    await bindTeamRole({
      userId: companionUserId,
      teamId: sharedWithAnotherAdminTeamId,
      role: TeamUserRole.ADMIN,
    });
  });

  afterAll(async () => {
    await resetApp();
    await cleanupTestRows(prisma, [
      ["roleBinding", { organizationId }],
      ["organizationUser", { organizationId }],
      ["team", { organizationId }],
      ["organization", { id: organizationId }],
      ["user", { id: { in: [adminUserId, soloUserId, companionUserId] } }],
    ]);
  });

  describe("when an organization admin moves them to a Lite Member seat", () => {
    /** @scenario Moving the only admin of a shared team to a Lite Member seat goes through */
    it("saves the seat change", async () => {
      await expect(
        moveSoloUserTo(OrganizationUserRole.EXTERNAL),
      ).resolves.toMatchObject({ success: true });

      await expect(
        prisma.organizationUser
          .findUnique({
            where: {
              userId_organizationId: { userId: soloUserId, organizationId },
            },
            select: { role: true },
          })
          .then((row) => row?.role),
      ).resolves.toBe(OrganizationUserRole.EXTERNAL);
    });

    /** @scenario Moving the only admin of a shared team to a Lite Member seat goes through */
    it("corrects their role on that team to viewer", async () => {
      await moveSoloUserTo(OrganizationUserRole.EXTERNAL);

      await expect(
        teamRoleOf({ userId: soloUserId, teamId: onlyAdminTeamId }),
      ).resolves.toBe(TeamUserRole.VIEWER);
    });

    /** @scenario The teams left without a team admin are named back to the admin */
    it("names every team left without a team admin", async () => {
      const result = await moveSoloUserTo(OrganizationUserRole.EXTERNAL);

      expect(
        result.teamsLeftWithoutAdmin.map((team) => team.id).sort(),
      ).toEqual([onlyAdminTeamId, alsoOnlyAdminTeamId].sort());
    });

    /** @scenario The teams left without a team admin are named back to the admin */
    it("names them the way their admin reads them", async () => {
      const result = await moveSoloUserTo(OrganizationUserRole.EXTERNAL);

      // The id is for the client to key off; the name is the only part a person
      // can act on, so a report carrying one without the other is not a report.
      expect(result.teamsLeftWithoutAdmin).toEqual(
        expect.arrayContaining([
          { id: onlyAdminTeamId, name: `solo-one ${ns}` },
        ]),
      );
    });

    /** @scenario The teams left without a team admin are named back to the admin */
    it("leaves out a team that still has another admin", async () => {
      const result = await moveSoloUserTo(OrganizationUserRole.EXTERNAL);

      expect(result.teamsLeftWithoutAdmin.map((team) => team.id)).not.toContain(
        sharedWithAnotherAdminTeamId,
      );
    });

    /** @scenario Moving the only admin of a shared team to a Lite Member seat goes through */
    it("leaves the team administered by the organization's admins", async () => {
      await moveSoloUserTo(OrganizationUserRole.EXTERNAL);

      // The whole reason this is allowed. If an organization admin could not
      // administer a team whose last team-scoped admin is gone, the guard would
      // be protecting something real and refusing would be correct.
      await expect(
        hasTeamPermission(
          {
            prisma,
            session: {
              user: { id: adminUserId, name: "Org Admin", email: adminEmail },
              expires: "1",
            } as any,
          },
          onlyAdminTeamId,
          "team:manage",
        ),
      ).resolves.toBe(true);
    });

    /** @scenario Moving the only admin of a shared team to a Lite Member seat goes through */
    it("restores their admin role when they are moved back", async () => {
      await moveSoloUserTo(OrganizationUserRole.EXTERNAL);
      await moveSoloUserTo(OrganizationUserRole.ADMIN);

      // An organization ADMIN keeps whatever team roles they hold, so the
      // correction is not undone here; what matters is that the round trip is
      // not refused now that the team has no other admin.
      await expect(
        prisma.organizationUser
          .findUnique({
            where: {
              userId_organizationId: { userId: soloUserId, organizationId },
            },
            select: { role: true },
          })
          .then((row) => row?.role),
      ).resolves.toBe(OrganizationUserRole.ADMIN);
    });
  });

  describe("when the caller names that team role outright", () => {
    /** @scenario A seat change that names team roles outright still keeps the guard */
    it("refuses, naming the team", async () => {
      await expect(
        callerAsAdmin().organization.updateMemberRole({
          organizationId,
          userId: soloUserId,
          role: OrganizationUserRole.EXTERNAL,
          teamRoleUpdates: [
            {
              teamId: onlyAdminTeamId,
              userId: soloUserId,
              role: TeamUserRole.VIEWER,
            },
          ],
        }),
      ).rejects.toMatchObject({
        cause: {
          code: "team_last_admin_required",
          meta: { teamName: `solo-one ${ns}` },
        },
      });
    });

    /** @scenario A seat change that names team roles outright still keeps the guard */
    it("saves nothing at all", async () => {
      await callerAsAdmin()
        .organization.updateMemberRole({
          organizationId,
          userId: soloUserId,
          role: OrganizationUserRole.EXTERNAL,
          teamRoleUpdates: [
            {
              teamId: onlyAdminTeamId,
              userId: soloUserId,
              role: TeamUserRole.VIEWER,
            },
          ],
        })
        .catch(() => undefined);

      await expect(
        teamRoleOf({ userId: soloUserId, teamId: onlyAdminTeamId }),
      ).resolves.toBe(TeamUserRole.ADMIN);
    });
  });

  describe("when an admin edits that team's own members", () => {
    /** @scenario Editing one team's members still refuses to remove its last admin */
    it("refuses, naming the team", async () => {
      await expect(
        callerAsAdmin().organization.updateTeamMemberRole({
          teamId: onlyAdminTeamId,
          userId: soloUserId,
          role: TeamUserRole.VIEWER,
        }),
      ).rejects.toMatchObject({
        cause: {
          code: "team_last_admin_required",
          meta: { teamName: `solo-one ${ns}` },
        },
      });
    });
  });
});

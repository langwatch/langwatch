/**
 * @vitest-environment node
 *
 * Integration tests for the admin batch-invite orchestrator,
 * `InviteService.createInvites`, against a real database.
 *
 * The personal-workspace scenario pins the guard from issue #6338: a
 * personal team belongs to the organization, so plain team validation lets
 * it through, and an invite accepted against it would hand a second person
 * the workspace its owner was promised privacy in.
 *
 * Covers @integration scenarios from
 * specs/organizations/organization-members-rest-api.feature.
 */

import { OrganizationUserRole, TeamUserRole } from "@prisma/client";
import { nanoid } from "nanoid";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanupTestRows } from "../../../test-utils/cleanupTestRows";
import { globalForApp, resetApp } from "../../app-layer/app";
import { createTestApp } from "../../app-layer/presets";
import { PlanProviderService } from "../../app-layer/subscription/plan-provider";
import { prisma } from "../../db";
import { InviteService } from "../invite.service";

const { mockSendInviteEmail } = vi.hoisted(() => ({
  mockSendInviteEmail: vi.fn(),
}));

// Never send real email from a test run; the dev environment can carry a
// real provider key. The URL builder stays real so listInvites is exercised.
vi.mock("../../mailer/inviteEmail", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../mailer/inviteEmail")>();
  return {
    ...original,
    sendInviteEmail: (...args: unknown[]) => mockSendInviteEmail(...args),
  };
});

// Pin the email-provider configuration so `emailNotSent` reads the same on
// every machine, configured provider key or not.
vi.mock("../../../env.mjs", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../env.mjs")>();
  return {
    ...original,
    env: {
      ...original.env,
      SENDGRID_API_KEY: "test-sendgrid-key",
      BASE_HOST: "http://localhost:3000",
    },
  };
});

/** A plan generous enough that seat limits never interfere with these tests. */
function makeTestPlan() {
  return {
    planSource: "subscription" as const,
    type: "PRO",
    name: "Pro",
    free: false,
    maxMembers: 100,
    maxMembersLite: 100,
    maxTeams: 100,
    maxProjects: 100,
    maxMessagesPerMonth: 100000,
    maxWorkflows: 100,
    maxPrompts: 100,
    maxEvaluators: 100,
    maxScenarios: 100,
    maxAgents: 100,
    maxExperiments: 100,
    maxOnlineEvaluations: 100,
    maxDatasets: 100,
    maxDashboards: 100,
    maxCustomGraphs: 100,
    maxAutomations: 100,
    canPublish: true,
    prices: { USD: 0, EUR: 0 },
    overrideAddingLimitations: false,
  };
}

describe("InviteService.createInvites", () => {
  const ns = `inv-orch-${nanoid(8)}`;
  let organizationId: string;
  let sharedTeamId: string;
  let personalTeamId: string;
  let ownerUserId: string;
  let service: InviteService;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "Invite Orchestrator Org", slug: `--test-${ns}` },
    });
    organizationId = organization.id;

    const owner = await prisma.user.create({
      data: { email: `owner-${ns}@test.com`, name: "Workspace Owner" },
    });
    ownerUserId = owner.id;

    await prisma.organizationUser.create({
      data: {
        userId: ownerUserId,
        organizationId,
        role: OrganizationUserRole.MEMBER,
      },
    });

    const sharedTeam = await prisma.team.create({
      data: {
        name: "Shared Team",
        slug: `--test-shared-${ns}`,
        organizationId,
      },
    });
    sharedTeamId = sharedTeam.id;

    const personalTeam = await prisma.team.create({
      data: {
        name: "Workspace Owner's Workspace",
        slug: `--test-personal-${ns}`,
        organizationId,
        isPersonal: true,
        ownerUserId,
      },
    });
    personalTeamId = personalTeam.id;

    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: async () => makeTestPlan(),
      }),
    });

    service = InviteService.create(prisma);
  });

  afterEach(async () => {
    await cleanupTestRows(prisma, [["organizationInvite", { organizationId }]]);
  });

  afterAll(async () => {
    await resetApp();
    await cleanupTestRows(prisma, [
      ["organizationInvite", { organizationId }],
      ["organizationUser", { organizationId }],
      ["team", { organizationId }],
      ["organization", { id: organizationId }],
      ["user", { email: `owner-${ns}@test.com` }],
    ]);
  });

  describe("given a member with a personal workspace in the organization", () => {
    /** @scenario An invite cannot assign a personal workspace team */
    it("refuses a team assignment on the personal workspace and creates no invite", async () => {
      await expect(
        service.createInvites({
          organizationId,
          invites: [
            {
              email: `newcomer-${ns}@test.com`,
              role: OrganizationUserRole.MEMBER,
              teams: [{ teamId: personalTeamId, role: TeamUserRole.MEMBER }],
            },
          ],
          validation: "strict",
        }),
      ).rejects.toMatchObject({
        code: "personal_workspace_not_managed_here",
      });

      const invites = await prisma.organizationInvite.findMany({
        where: { organizationId },
      });
      expect(invites).toHaveLength(0);
    });

    it("refuses the same assignment in lenient mode, because the guard is an invariant rather than a strictness option", async () => {
      // Lenient mode exists to drop invalid assignments quietly for the
      // invite form; sharing a personal workspace is refused loudly on every
      // path (issue #6338).
      await expect(
        service.createInvites({
          organizationId,
          invites: [
            {
              email: `newcomer-lenient-${ns}@test.com`,
              role: OrganizationUserRole.MEMBER,
              teams: [{ teamId: personalTeamId, role: TeamUserRole.MEMBER }],
            },
          ],
          validation: "lenient",
        }),
      ).rejects.toMatchObject({
        code: "personal_workspace_not_managed_here",
      });

      const invites = await prisma.organizationInvite.findMany({
        where: { organizationId },
      });
      expect(invites).toHaveLength(0);
    });

    it("still creates invites for shared teams", async () => {
      const result = await service.createInvites({
        organizationId,
        invites: [
          {
            email: `welcome-${ns}@test.com`,
            role: OrganizationUserRole.MEMBER,
            teams: [{ teamId: sharedTeamId, role: TeamUserRole.MEMBER }],
          },
        ],
        validation: "strict",
      });

      expect(result.invites).toHaveLength(1);
      expect(result.invites[0]!.invite.email).toBe(`welcome-${ns}@test.com`);
      expect(result.invites[0]!.emailNotSent).toBe(false);
    });
  });

  describe("when a team assignment names a team from another organization", () => {
    it("refuses the batch in strict mode with team_not_in_organization", async () => {
      await expect(
        service.createInvites({
          organizationId,
          invites: [
            {
              email: `foreign-${ns}@test.com`,
              role: OrganizationUserRole.MEMBER,
              teams: [
                { teamId: "team_does_not_exist", role: TeamUserRole.MEMBER },
              ],
            },
          ],
          validation: "strict",
        }),
      ).rejects.toMatchObject({ code: "team_not_in_organization" });

      const invites = await prisma.organizationInvite.findMany({
        where: { organizationId },
      });
      expect(invites).toHaveLength(0);
    });

    it("drops the invite in lenient mode, the invite form's historical behavior", async () => {
      const result = await service.createInvites({
        organizationId,
        invites: [
          {
            email: `foreign-lenient-${ns}@test.com`,
            role: OrganizationUserRole.MEMBER,
            teams: [
              { teamId: "team_does_not_exist", role: TeamUserRole.MEMBER },
            ],
          },
        ],
        validation: "lenient",
      });

      expect(result.invites).toHaveLength(0);
    });
  });

  describe("when an invite for the address is already pending", () => {
    it("reports the duplicate in strict mode and rolls the batch back", async () => {
      await service.createInvites({
        organizationId,
        invites: [
          {
            email: `dupe-${ns}@test.com`,
            role: OrganizationUserRole.MEMBER,
            teams: [{ teamId: sharedTeamId, role: TeamUserRole.MEMBER }],
          },
        ],
        validation: "strict",
      });

      await expect(
        service.createInvites({
          organizationId,
          invites: [
            {
              email: `dupe-${ns}@test.com`,
              role: OrganizationUserRole.MEMBER,
              teams: [{ teamId: sharedTeamId, role: TeamUserRole.MEMBER }],
            },
            {
              email: `fresh-${ns}@test.com`,
              role: OrganizationUserRole.MEMBER,
              teams: [{ teamId: sharedTeamId, role: TeamUserRole.MEMBER }],
            },
          ],
          validation: "strict",
        }),
      ).rejects.toMatchObject({ code: "duplicate_invite" });

      // The transaction rolled back: the fresh address was not created.
      const freshInvites = await prisma.organizationInvite.findMany({
        where: { organizationId, email: `fresh-${ns}@test.com` },
      });
      expect(freshInvites).toHaveLength(0);
    });

    it("skips the duplicate in lenient mode and creates the rest", async () => {
      await service.createInvites({
        organizationId,
        invites: [
          {
            email: `dupe-lenient-${ns}@test.com`,
            role: OrganizationUserRole.MEMBER,
            teams: [{ teamId: sharedTeamId, role: TeamUserRole.MEMBER }],
          },
        ],
        validation: "lenient",
      });

      const result = await service.createInvites({
        organizationId,
        invites: [
          {
            email: `dupe-lenient-${ns}@test.com`,
            role: OrganizationUserRole.MEMBER,
            teams: [{ teamId: sharedTeamId, role: TeamUserRole.MEMBER }],
          },
          {
            email: `fresh-lenient-${ns}@test.com`,
            role: OrganizationUserRole.MEMBER,
            teams: [{ teamId: sharedTeamId, role: TeamUserRole.MEMBER }],
          },
        ],
        validation: "lenient",
      });

      expect(result.invites).toHaveLength(1);
      expect(result.invites[0]!.invite.email).toBe(
        `fresh-lenient-${ns}@test.com`,
      );
    });
  });

  describe("when the address already belongs to a member", () => {
    it("refuses the batch before writing anything", async () => {
      await expect(
        service.createInvites({
          organizationId,
          invites: [
            {
              email: `owner-${ns}@test.com`,
              role: OrganizationUserRole.MEMBER,
              teams: [{ teamId: sharedTeamId, role: TeamUserRole.MEMBER }],
            },
          ],
          validation: "strict",
        }),
      ).rejects.toMatchObject({ code: "already_organization_member" });
    });
  });

  describe("listInvites", () => {
    it("returns the acceptance link with each pending invite", async () => {
      await service.createInvites({
        organizationId,
        invites: [
          {
            email: `listed-${ns}@test.com`,
            role: OrganizationUserRole.MEMBER,
            teams: [{ teamId: sharedTeamId, role: TeamUserRole.MEMBER }],
          },
        ],
        validation: "strict",
      });

      const invites = await service.listInvites({ organizationId });

      expect(invites).toHaveLength(1);
      expect(invites[0]!.email).toBe(`listed-${ns}@test.com`);
      expect(invites[0]!.inviteUrl).toContain(
        `/invite/accept?inviteCode=${invites[0]!.inviteCode}`,
      );
    });
  });

  describe("revokeInvite", () => {
    it("deletes a pending invite and answers not found for an unknown id", async () => {
      const created = await service.createInvites({
        organizationId,
        invites: [
          {
            email: `revoked-${ns}@test.com`,
            role: OrganizationUserRole.MEMBER,
            teams: [{ teamId: sharedTeamId, role: TeamUserRole.MEMBER }],
          },
        ],
        validation: "strict",
      });
      const inviteId = created.invites[0]!.invite.id;

      await service.revokeInvite({ organizationId, inviteId });

      const remaining = await prisma.organizationInvite.findMany({
        where: { organizationId },
      });
      expect(remaining).toHaveLength(0);

      await expect(
        service.revokeInvite({ organizationId, inviteId }),
      ).rejects.toMatchObject({ code: "invite_not_found" });
    });
  });
});

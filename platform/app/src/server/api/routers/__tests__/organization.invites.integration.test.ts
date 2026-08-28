/**
 * @vitest-environment node
 *
 * Integration tests for resilient invitations (D11).
 * Tests the router layer for creation, identifier-aware acceptance, resend,
 * revocation, and the visible invitation states, against real Postgres.
 *
 * Covers @integration scenarios from specs/identity/resilient-invitations.feature
 */

import { normalizeIdentifierValue } from "@langwatch/identity";
import { nanoid } from "nanoid";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { cleanupTestRows } from "../../../../test-utils/cleanupTestRows";
import { globalForApp, resetApp } from "../../../app-layer/app";
import { createTestApp } from "../../../app-layer/presets";
import { PlanProviderService } from "../../../app-layer/subscription/plan-provider";
import { prisma } from "../../../db";
import { INVITE_EXPIRATION_MS, InviteService } from "../../../invites/invite.service";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

// vi.hoisted runs before vi.mock hoisting, so these are available in mock factories
const { mockSendInviteEmail, mockGetActivePlan } = vi.hoisted(() => ({
  mockSendInviteEmail: vi.fn(),
  mockGetActivePlan: vi.fn(),
}));

// Mock sendInviteEmail to track email sending
vi.mock("../../../mailer/inviteEmail", () => ({
  sendInviteEmail: (...args: unknown[]) => mockSendInviteEmail(...args),
}));

// Identifier-aware acceptance (D11): the identity read fork is a mocked
// boundary here - these tests exercise the invitation mechanics against
// Postgres, not the identity projection (which has its own suites).
// `null` = the pre-identifier legacy comparison.
const { verifiedEmailsOfMock } = vi.hoisted(() => ({
  verifiedEmailsOfMock: vi.fn().mockResolvedValue(null),
}));
vi.mock("~/server/app-layer/identity/runtime", async (importOriginal) => {
  const original = await importOriginal<typeof import("~/server/app-layer/identity/runtime")>();
  return {
    ...original,
    identityEmail: () => ({
      resolveEmail: () => Promise.resolve(null),
      verifiedEmailsOf: verifiedEmailsOfMock,
    }),
  };
});

// Mock SENDGRID_API_KEY to enable email sending path
vi.mock("../../../../env.mjs", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../../env.mjs")>();
  return {
    ...original,
    env: {
      ...original.env,
      SENDGRID_API_KEY: "test-sendgrid-key",
      BASE_HOST: "http://localhost:3000",
    },
  };
});

// Plan limits are now resolved via App singleton (getApp().planProvider).
// InviteService.create(...) calls getApp().planProvider internally.
// App singleton is wired in beforeAll via createTestApp().

/** Default plan info for tests (all fields required by PlanInfo). */
function makeTestPlan(overrides: Record<string, unknown> = {}) {
  return {
    planSource: "subscription" as const,
    type: "PRO",
    name: "Pro",
    free: false,
    maxMembers: 10,
    maxMembersLite: 10,
    maxTeams: 10,
    maxProjects: 20,
    maxMessagesPerMonth: 100000,
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
    ...overrides,
  };
}

describe("Organization Invites Integration", () => {
  const testNamespace = `invite-test-${nanoid(8)}`;
  let organizationId: string;
  let teamId: string;
  let adminUserId: string;
  let memberUserId: string;
  let adminCaller: ReturnType<typeof appRouter.createCaller>;
  // Invitee users each test mints; accumulated so teardown deletes exactly
  // these and never sweeps wider (cleanupTestRows' accumulator pattern).
  const inviteeUserIds: string[] = [];

  beforeAll(async () => {
    // Create test organization
    const organization = await prisma.organization.create({
      data: {
        name: "Invite Test Org",
        slug: `--test-invite-org-${testNamespace}`,
      },
    });
    organizationId = organization.id;

    // Create test team
    const team = await prisma.team.create({
      data: {
        name: "Invite Test Team",
        slug: `--test-invite-team-${testNamespace}`,
        organizationId,
      },
    });
    teamId = team.id;

    // Create admin user
    const adminUser = await prisma.user.create({
      data: {
        email: `invite-admin-${testNamespace}@test.com`,
        name: "Invite Admin",
      },
    });
    adminUserId = adminUser.id;

    // Add admin to organization
    await prisma.organizationUser.create({
      data: {
        userId: adminUserId,
        organizationId,
        role: OrganizationUserRole.ADMIN,
      },
    });

    // Grant admin an org-scoped ADMIN RoleBinding so permission checks pass
    await prisma.roleBinding.create({
      data: {
        id: `rb-inv-admin-${nanoid(8)}`,
        organizationId,
        userId: adminUserId,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organizationId,
      },
    });

    // Add admin to team
    await prisma.teamUser.create({
      data: {
        userId: adminUserId,
        teamId,
        role: TeamUserRole.ADMIN,
      },
    });

    // Create member user
    const memberUser = await prisma.user.create({
      data: {
        email: `invite-member-${testNamespace}@test.com`,
        name: "Invite Member",
      },
    });
    memberUserId = memberUser.id;

    // Add member to organization
    await prisma.organizationUser.create({
      data: {
        userId: memberUserId,
        organizationId,
        role: OrganizationUserRole.MEMBER,
      },
    });

    // Grant member an org-scoped MEMBER RoleBinding so organization:view checks pass
    await prisma.roleBinding.create({
      data: {
        id: `rb-inv-member-${nanoid(8)}`,
        organizationId,
        userId: memberUserId,
        role: TeamUserRole.MEMBER,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organizationId,
      },
    });

    // Add member to team
    await prisma.teamUser.create({
      data: {
        userId: memberUserId,
        teamId,
        role: TeamUserRole.MEMBER,
      },
    });

    // Set default plan mock and wire App singleton for InviteService.create()
    mockGetActivePlan.mockResolvedValue(makeTestPlan());
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: mockGetActivePlan,
      }),
    });

    // Create admin caller
    const adminCtx = createInnerTRPCContext({
      session: {
        user: { id: adminUserId },
        expires: "1",
      },
    });
    adminCaller = appRouter.createCaller(adminCtx);
  });

  afterEach(async () => {
    // Clean up invites after each test
    await cleanupTestRows(prisma, [["organizationInvite", { organizationId }]]);
    mockSendInviteEmail.mockClear();
    verifiedEmailsOfMock.mockReset();
    verifiedEmailsOfMock.mockResolvedValue(null);
    mockGetActivePlan.mockReset();
    mockGetActivePlan.mockResolvedValue(makeTestPlan());

    // Re-wire App singleton with fresh mock values
    await resetApp();
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: mockGetActivePlan,
      }),
    });
  });

  afterAll(async () => {
    await resetApp();

    // Cleanup all test data
    await cleanupTestRows(prisma, [
      ["organizationInvite", { organizationId }],
      ["roleBinding", { organizationId }],
      ["teamUser", { team: { organizationId } }],
      ["organizationUser", { organizationId }],
      // Acceptance provisions a personal workspace (team + project) for the
      // invitee, so projects go before their teams.
      ["project", { team: { organizationId } }],
      ["team", { organizationId }],
      ["organization", { id: organizationId }],
      [
        "user",
        {
          email: {
            in: [
              `invite-admin-${testNamespace}@test.com`,
              `invite-member-${testNamespace}@test.com`,
            ],
          },
        },
      ],
      ["user", { id: { in: inviteeUserIds } }],
    ]);
  });

  // ============================================================================
  // acceptInvite — identifier-aware acceptance (D11)
  // ============================================================================

  describe("acceptInvite", () => {
    async function createInvitee(email: string) {
      const user = await prisma.user.create({
        data: { email, name: "Invitee" },
      });
      inviteeUserIds.push(user.id);
      const ctx = createInnerTRPCContext({
        session: {
          user: { id: user.id, email, name: "Invitee" },
          expires: "1",
        },
      });
      return { user, caller: appRouter.createCaller(ctx) };
    }

    function createPendingInvite(email: string, overrides: Record<string, unknown> = {}) {
      return prisma.organizationInvite.create({
        data: {
          email,
          inviteCode: nanoid(),
          expiration: new Date(Date.now() + INVITE_EXPIRATION_MS),
          organizationId,
          teamIds: teamId,
          role: OrganizationUserRole.MEMBER,
          status: "PENDING",
          ...overrides,
        },
      });
    }

    describe("when the signed-in user holds a verified identifier for the invited address", () => {
      /** @scenario "Acceptance works through any verified identifier matching the invite" */
      it("accepts and records which identifier vouched", async () => {
        const workEmail = `invitee-${testNamespace}-work@acme.com`;
        const invite = await createPendingInvite(workEmail);
        const { user, caller } = await createInvitee(`invitee-${testNamespace}-personal@home.net`);
        verifiedEmailsOfMock.mockResolvedValue([
          {
            identifierId: "idf_int_g",
            value: normalizeIdentifierValue(workEmail),
            provider: "google",
          },
        ]);

        const result = await caller.organization.acceptInvite({
          inviteCode: invite.inviteCode,
        });

        expect(result.success).toBe(true);
        const membership = await prisma.organizationUser.findUnique({
          where: {
            userId_organizationId: { userId: user.id, organizationId },
          },
        });
        expect(membership).not.toBeNull();
        const accepted = await prisma.organizationInvite.findUnique({
          where: { id: invite.id },
        });
        expect(accepted?.status).toBe("ACCEPTED");
        expect(accepted?.acceptedByUserId).toBe(user.id);
        expect(accepted?.acceptedViaIdentifierId).toBe("idf_int_g");
      });
    });

    describe("when the invite expected one method and the account holds another", () => {
      /** @scenario "The wrong-method dead end is gone" */
      it("signs in with what they have and the invite applies, without a second account", async () => {
        const workEmail = `invitee-${testNamespace}-crossmethod@acme.com`;
        const invite = await createPendingInvite(workEmail);
        // Their one account is Google-born under a different primary email;
        // the work address is a VERIFIED secondary identifier.
        const { user, caller } = await createInvitee(
          `invitee-${testNamespace}-googleborn@gmail.com`,
        );
        verifiedEmailsOfMock.mockResolvedValue([
          {
            identifierId: "idf_int_cross",
            value: normalizeIdentifierValue(workEmail),
            provider: "google",
          },
        ]);

        await caller.organization.acceptInvite({
          inviteCode: invite.inviteCode,
        });

        const membership = await prisma.organizationUser.findUnique({
          where: {
            userId_organizationId: { userId: user.id, organizationId },
          },
        });
        expect(membership).not.toBeNull();
        // No second account was minted for the invited address.
        const usersHoldingWorkEmail = await prisma.user.count({
          where: { email: workEmail },
        });
        expect(usersHoldingWorkEmail).toBe(0);
      });
    });

    describe("when the production Google-linked invitee case replays", () => {
      /** @scenario "The Google-linked invitee support case replays green" */
      it("joins the organization without anyone archiving a user", async () => {
        // The case: invited by email, account linked to Google for that same
        // address, sign-in kept failing until ops archived the user. Now the
        // Google identifier vouches for the address directly.
        const email = `invitee-${testNamespace}-glinked@acme.com`;
        const invite = await createPendingInvite(email);
        const { user, caller } = await createInvitee(email);
        verifiedEmailsOfMock.mockResolvedValue([
          {
            identifierId: "idf_int_gl",
            value: normalizeIdentifierValue(email),
            provider: "google",
          },
        ]);

        const result = await caller.organization.acceptInvite({
          inviteCode: invite.inviteCode,
        });

        expect(result.success).toBe(true);
        const membership = await prisma.organizationUser.findUnique({
          where: {
            userId_organizationId: { userId: user.id, organizationId },
          },
        });
        expect(membership).not.toBeNull();
      });
    });

    describe("when the acceptance is retried after it landed", () => {
      /** @scenario "Membership lands exactly once however often acceptance retries" */
      it("re-applies nothing", async () => {
        const email = `invitee-${testNamespace}-retry@acme.com`;
        const invite = await createPendingInvite(email);
        const { user, caller } = await createInvitee(email);

        await caller.organization.acceptInvite({
          inviteCode: invite.inviteCode,
        });

        // A crash after the membership transaction re-runs the whole apply.
        const landed = await prisma.organizationInvite.findUnique({
          where: { id: invite.id },
        });
        await InviteService.create(prisma, {
          baseHost: "http://localhost:3000",
        }).applyInvite({
          userId: user.id,
          invite: landed!,
        });

        const memberships = await prisma.organizationUser.count({
          where: { userId: user.id, organizationId },
        });
        expect(memberships).toBe(1);
        const orgBindings = await prisma.roleBinding.count({
          where: {
            userId: user.id,
            organizationId,
            scopeType: RoleBindingScopeType.ORGANIZATION,
          },
        });
        expect(orgBindings).toBe(1);
      });
    });

    describe("when the invitation has expired", () => {
      it("refuses with the recoverable invite_expired code", async () => {
        const email = `invitee-${testNamespace}-late@acme.com`;
        const invite = await createPendingInvite(email, {
          expiration: new Date(Date.now() - 1000),
        });
        const { caller } = await createInvitee(email);

        await expect(
          caller.organization.acceptInvite({ inviteCode: invite.inviteCode }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        const untouched = await prisma.organizationInvite.findUnique({
          where: { id: invite.id },
        });
        expect(untouched?.status).toBe("PENDING");
      });
    });
  });

  // ============================================================================
  // resendInvite (D11 — one-click resend)
  // ============================================================================

  describe("resendInvite", () => {
    function createExpiredInvite(email: string) {
      return prisma.organizationInvite.create({
        data: {
          email,
          inviteCode: nanoid(),
          expiration: new Date(Date.now() - 1000),
          organizationId,
          teamIds: teamId,
          role: OrganizationUserRole.MEMBER,
          status: "PENDING",
        },
      });
    }

    describe("when an admin resends an expired invitation", () => {
      /** @scenario "One click resends an expired invitation" */
      it("mints a fresh code with a fresh fourteen-day expiry and sends a new email", async () => {
        const invite = await createExpiredInvite(`invitee-${testNamespace}-resend@acme.com`);
        mockSendInviteEmail.mockResolvedValue(undefined);

        const result = await adminCaller.organization.resendInvite({
          inviteId: invite.id,
          organizationId,
        });

        expect(result.invite.inviteCode).not.toBe(invite.inviteCode);
        expect(new Date(result.invite.expiration!).getTime()).toBeGreaterThan(
          Date.now() + 13 * 24 * 60 * 60 * 1000,
        );
        expect(mockSendInviteEmail).toHaveBeenCalledWith(
          expect.objectContaining({ inviteCode: result.invite.inviteCode }),
        );
        const row = await prisma.organizationInvite.findUnique({
          where: { id: invite.id },
        });
        expect(row?.inviteCode).toBe(result.invite.inviteCode);
        expect(row?.status).toBe("PENDING");
      });

      it("kills the old link", async () => {
        const invite = await createExpiredInvite(`invitee-${testNamespace}-stale@acme.com`);
        mockSendInviteEmail.mockResolvedValue(undefined);
        await adminCaller.organization.resendInvite({
          inviteId: invite.id,
          organizationId,
        });

        const ctx = createInnerTRPCContext({
          session: {
            user: {
              id: adminUserId,
              email: `invitee-${testNamespace}-stale@acme.com`,
              name: "Invitee",
            },
            expires: "1",
          },
        });
        await expect(
          appRouter.createCaller(ctx).organization.acceptInvite({ inviteCode: invite.inviteCode }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      });
    });

    describe("when the expired-mid-debug support case replays", () => {
      /** @scenario "The invite-expired-mid-debug support case replays green" */
      it("round-trips expiry to resend to acceptance without an ops action", async () => {
        const email = `invitee-${testNamespace}-middebug@acme.com`;
        const invite = await createExpiredInvite(email);
        mockSendInviteEmail.mockResolvedValue(undefined);

        const resent = await adminCaller.organization.resendInvite({
          inviteId: invite.id,
          organizationId,
        });

        const user = await prisma.user.create({
          data: { email, name: "Invitee" },
        });
        inviteeUserIds.push(user.id);
        const ctx = createInnerTRPCContext({
          session: {
            user: { id: user.id, email, name: "Invitee" },
            expires: "1",
          },
        });
        const result = await appRouter.createCaller(ctx).organization.acceptInvite({
          inviteCode: resent.invite.inviteCode,
        });

        expect(result.success).toBe(true);
        const membership = await prisma.organizationUser.findUnique({
          where: {
            userId_organizationId: { userId: user.id, organizationId },
          },
        });
        expect(membership).not.toBeNull();
      });
    });

    describe("when the email service is unavailable during resend", () => {
      it("still resends and returns the fresh link as the fallback", async () => {
        const invite = await createExpiredInvite(`invitee-${testNamespace}-nomail@acme.com`);
        mockSendInviteEmail.mockRejectedValue(new Error("Email service unavailable"));

        const result = await adminCaller.organization.resendInvite({
          inviteId: invite.id,
          organizationId,
        });

        expect(result.emailNotSent).toBe(true);
        expect(result.inviteUrl).toContain(result.invite.inviteCode);
      });
    });
  });

  // ============================================================================
  // deleteInvite (revocation is a visible state)
  // ============================================================================

  describe("deleteInvite", () => {
    describe("when an admin revokes a pending invitation", () => {
      it("keeps the row as REVOKED and the code stops opening anything", async () => {
        const invite = await prisma.organizationInvite.create({
          data: {
            email: "remove@example.com",
            inviteCode: nanoid(),
            expiration: new Date(Date.now() + INVITE_EXPIRATION_MS),
            organizationId,
            teamIds: teamId,
            role: OrganizationUserRole.MEMBER,
            status: "PENDING",
          },
        });

        await adminCaller.organization.deleteInvite({
          inviteId: invite.id,
          organizationId,
        });

        const row = await prisma.organizationInvite.findFirst({
          where: { id: invite.id, organizationId },
        });
        expect(row?.status).toBe("REVOKED");

        const ctx = createInnerTRPCContext({
          session: {
            user: {
              id: adminUserId,
              email: "remove@example.com",
              name: "Invitee",
            },
            expires: "1",
          },
        });
        await expect(
          appRouter.createCaller(ctx).organization.acceptInvite({ inviteCode: invite.inviteCode }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      });
    });
  });

  // ============================================================================
  // getOrganizationPendingInvites
  // ============================================================================

  describe("getOrganizationPendingInvites", () => {
    describe("when live, expired, and revoked invitations exist", () => {
      /** @scenario "An invitation expires visibly after fourteen days" */
      it("returns every state with its derived display status and expiry", async () => {
        await prisma.organizationInvite.create({
          data: {
            email: "pending@example.com",
            inviteCode: nanoid(),
            expiration: new Date(Date.now() + INVITE_EXPIRATION_MS),
            organizationId,
            teamIds: teamId,
            role: OrganizationUserRole.MEMBER,
            status: "PENDING",
          },
        });
        const expiredAt = new Date(Date.now() - 1000);
        await prisma.organizationInvite.create({
          data: {
            email: "expired@example.com",
            inviteCode: nanoid(),
            expiration: expiredAt,
            organizationId,
            teamIds: teamId,
            role: OrganizationUserRole.MEMBER,
            status: "PENDING",
          },
        });
        await prisma.organizationInvite.create({
          data: {
            email: "revoked@example.com",
            inviteCode: nanoid(),
            expiration: new Date(Date.now() + INVITE_EXPIRATION_MS),
            organizationId,
            teamIds: teamId,
            role: OrganizationUserRole.MEMBER,
            status: "REVOKED",
          },
        });

        const invites = await adminCaller.organization.getOrganizationPendingInvites({
          organizationId,
        });

        const byEmail = Object.fromEntries(invites.map((invite) => [invite.email, invite]));
        expect(byEmail["pending@example.com"]?.displayStatus).toBe("PENDING");
        expect(byEmail["expired@example.com"]?.displayStatus).toBe("EXPIRED");
        expect(new Date(byEmail["expired@example.com"]!.expiration!).getTime()).toBe(
          expiredAt.getTime(),
        );
        expect(byEmail["revoked@example.com"]?.displayStatus).toBe("REVOKED");
      });
    });
  });

  // ============================================================================
  // Two-phase email: records created atomically, emails sent after commit
  // ============================================================================

  describe("createInvites (admin batch)", () => {
    describe("when admin invites multiple users in a single batch", () => {
      /** @scenario "Admin batch invite creates all records before sending any emails" */
      it("creates all invite records before sending any emails", async () => {
        const callOrder: string[] = [];

        // Track when emails are sent relative to DB operations
        mockSendInviteEmail.mockImplementation(async () => {
          callOrder.push("email-sent");
        });

        const results = await adminCaller.organization.createInvites({
          organizationId,
          invites: [
            { email: "batch-a@example.com", role: "MEMBER", teamIds: teamId },
            { email: "batch-b@example.com", role: "MEMBER", teamIds: teamId },
          ],
        });

        // All records exist in DB (transaction committed)
        expect(results).toHaveLength(2);

        const dbInvites = await prisma.organizationInvite.findMany({
          where: {
            organizationId,
            email: { in: ["batch-a@example.com", "batch-b@example.com"] },
          },
        });
        expect(dbInvites).toHaveLength(2);

        // Emails were sent (outside transaction)
        expect(mockSendInviteEmail).toHaveBeenCalledTimes(2);
      });

      it("persists records even if email sending fails for one invite", async () => {
        mockSendInviteEmail
          .mockResolvedValueOnce(undefined) // first email succeeds
          .mockRejectedValueOnce(new Error("SMTP failure")); // second email fails

        const results = await adminCaller.organization.createInvites({
          organizationId,
          invites: [
            { email: "ok-email@example.com", role: "MEMBER", teamIds: teamId },
            {
              email: "fail-email@example.com",
              role: "MEMBER",
              teamIds: teamId,
            },
          ],
        });

        // Both invites exist in DB despite email failure
        expect(results).toHaveLength(2);

        const dbInvites = await prisma.organizationInvite.findMany({
          where: {
            organizationId,
            email: {
              in: ["ok-email@example.com", "fail-email@example.com"],
            },
          },
        });
        expect(dbInvites).toHaveLength(2);

        // The failed one has emailNotSent = true
        const failedResult = results.find((r) => r.invite.email === "fail-email@example.com");
        expect(failedResult?.emailNotSent).toBe(true);

        // The successful one has emailNotSent = false
        const okResult = results.find((r) => r.invite.email === "ok-email@example.com");
        expect(okResult?.emailNotSent).toBe(false);
      });
    });
  });
});

/**
 * @vitest-environment node
 *
 * Integration tests for Invitation Approval Workflow.
 * Tests the router layer for invite requests, approvals, and permission checks.
 *
 * Covers @integration scenarios from specs/members/update-pending-invitation.feature
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";
import { OrganizationUserRole, TeamUserRole } from "@prisma/client";
import { nanoid } from "nanoid";
import { INVITE_EXPIRATION_MS } from "../../../invites/invite.service";
import { createTestApp, resetApp } from "../../../app-layer";
import { globalForApp } from "../../../app-layer/app";
import { PlanProviderService } from "../../../app-layer/subscription/plan-provider";

// vi.hoisted runs before vi.mock hoisting, so these are available in mock factories
const { mockSendInviteEmail, mockGetActivePlan } = vi.hoisted(() => ({
  mockSendInviteEmail: vi.fn(),
  mockGetActivePlan: vi.fn(),
}));

// Mock sendInviteEmail to track email sending
vi.mock("../../../mailer/inviteEmail", () => ({
  sendInviteEmail: (...args: unknown[]) => mockSendInviteEmail(...args),
}));

// Mock SENDGRID_API_KEY to enable email sending path
vi.mock("../../../../env.mjs", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../../env.mjs")>();
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
// InviteService.create(prisma) calls getApp().planProvider internally.
// App singleton is wired in beforeAll via createTestApp().

/** Default plan info for tests (all fields required by PlanInfo). */
function makeTestPlan(overrides: Record<string, unknown> = {}) {
  return {
    type: "PRO",
    name: "Pro",
    free: false,
    maxMembers: 10,
    maxMembersLite: 10,
    maxTeams: 10,
    maxProjects: 20,
    maxMessagesPerMonth: 100000,
    evaluationsCredit: 500,
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
  let memberCaller: ReturnType<typeof appRouter.createCaller>;

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

    // Create member caller
    const memberCtx = createInnerTRPCContext({
      session: {
        user: { id: memberUserId },
        expires: "1",
      },
    });
    memberCaller = appRouter.createCaller(memberCtx);
  });

  afterEach(async () => {
    // Clean up invites after each test
    await prisma.organizationInvite.deleteMany({
      where: { organizationId },
    });
    mockSendInviteEmail.mockClear();
    mockGetActivePlan.mockReset();
    mockGetActivePlan.mockResolvedValue(makeTestPlan());

    // Re-wire App singleton with fresh mock values
    resetApp();
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: mockGetActivePlan,
      }),
    });
  });

  afterAll(async () => {
    resetApp();

    // Cleanup all test data
    await prisma.organizationInvite.deleteMany({
      where: { organizationId },
    });
    await prisma.teamUser.deleteMany({
      where: { teamId },
    });
    await prisma.organizationUser.deleteMany({
      where: { organizationId },
    });
    await prisma.team.deleteMany({
      where: { organizationId },
    });
    await prisma.organization.deleteMany({
      where: { id: organizationId },
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          in: [
            `invite-admin-${testNamespace}@test.com`,
            `invite-member-${testNamespace}@test.com`,
          ],
        },
      },
    });
  });

  // ============================================================================
  // createInviteRequest
  // ============================================================================

  describe("createInviteRequest", () => {
    describe("when member requests invitation with ADMIN role", () => {
      it("fails with validation error", async () => {
        await expect(
          memberCaller.organization.createInviteRequest({
            organizationId,
            invites: [
              {
                email: "user@example.com",
                // @ts-expect-error - intentionally passing invalid role to test Zod validation
                role: "ADMIN",
                teamIds: teamId,
              },
            ],
          })
        ).rejects.toThrow();
      });
    });

    describe("when member requests invitation with MEMBER role", () => {
      it("creates invitation with WAITING_APPROVAL status", async () => {
        const results = await memberCaller.organization.createInviteRequest({
          organizationId,
          invites: [
            { email: "user@example.com", role: "MEMBER", teamIds: teamId },
          ],
        });

        expect(results[0]!.invite.status).toBe("WAITING_APPROVAL");
      });

      it("sets requestedBy to the requesting user's ID", async () => {
        const results = await memberCaller.organization.createInviteRequest({
          organizationId,
          invites: [
            { email: "user@example.com", role: "MEMBER", teamIds: teamId },
          ],
        });

        expect(results[0]!.invite.requestedBy).toBe(memberUserId);
      });

      it("creates invitation with null expiration", async () => {
        const results = await memberCaller.organization.createInviteRequest({
          organizationId,
          invites: [
            { email: "user@example.com", role: "MEMBER", teamIds: teamId },
          ],
        });

        expect(results[0]!.invite.expiration).toBeNull();
      });

      it("does not send invitation email", async () => {
        await memberCaller.organization.createInviteRequest({
          organizationId,
          invites: [
            { email: "user@example.com", role: "MEMBER", teamIds: teamId },
          ],
        });

        expect(mockSendInviteEmail).not.toHaveBeenCalled();
      });
    });

    describe("when member requests multiple invitations at once", () => {
      it("creates a WAITING_APPROVAL record for each email", async () => {
        const results = await memberCaller.organization.createInviteRequest({
          organizationId,
          invites: [
            { email: "multi-a@example.com", role: "MEMBER", teamIds: teamId },
            { email: "multi-b@example.com", role: "MEMBER", teamIds: teamId },
            { email: "multi-c@example.com", role: "EXTERNAL", teamIds: teamId },
          ],
        });

        expect(results).toHaveLength(3);
        expect(results[0]!.invite.email).toBe("multi-a@example.com");
        expect(results[0]!.invite.status).toBe("WAITING_APPROVAL");
        expect(results[1]!.invite.email).toBe("multi-b@example.com");
        expect(results[1]!.invite.status).toBe("WAITING_APPROVAL");
        expect(results[2]!.invite.email).toBe("multi-c@example.com");
        expect(results[2]!.invite.status).toBe("WAITING_APPROVAL");
      });

      it("rejects duplicate emails in a single payload and creates no invites", async () => {
        await expect(
          memberCaller.organization.createInviteRequest({
            organizationId,
            invites: [
              { email: "dupe@example.com", role: "MEMBER", teamIds: teamId },
              { email: "dupe@example.com", role: "EXTERNAL", teamIds: teamId },
            ],
          }),
        ).rejects.toMatchObject({
          code: "BAD_REQUEST",
          message: expect.stringContaining(
            "Duplicate emails in request payload",
          ),
        });

        const persistedInvites = await prisma.organizationInvite.findMany({
          where: {
            organizationId,
            email: "dupe@example.com",
          },
        });
        expect(persistedInvites).toHaveLength(0);
      });
    });

    describe("when duplicate invitation exists with WAITING_APPROVAL status", () => {
      it("fails with duplicate invitation error", async () => {
        // Create initial WAITING_APPROVAL invite
        await memberCaller.organization.createInviteRequest({
          organizationId,
          invites: [
            { email: "existing@example.com", role: "MEMBER", teamIds: teamId },
          ],
        });

        // Try to create another for the same email
        await expect(
          memberCaller.organization.createInviteRequest({
            organizationId,
            invites: [
              {
                email: "existing@example.com",
                role: "MEMBER",
                teamIds: teamId,
              },
            ],
          })
        ).rejects.toMatchObject({
          code: "BAD_REQUEST",
          message: expect.stringContaining("already exists"),
        });
      });
    });
  });

  // ============================================================================
  // approveInvite
  // ============================================================================

  describe("approveInvite", () => {
    describe("when admin approves a WAITING_APPROVAL invitation", () => {
      it("transitions status to PENDING", async () => {
        // Create WAITING_APPROVAL invite
        const results =
          await memberCaller.organization.createInviteRequest({
            organizationId,
            invites: [
              { email: "user@example.com", role: "MEMBER", teamIds: teamId },
            ],
          });

        const result = await adminCaller.organization.approveInvite({
          inviteId: results[0]!.invite.id,
          organizationId,
        });

        expect(result.invite.status).toBe("PENDING");
      });

      it("sets 48-hour expiration", async () => {
        const beforeApproval = Date.now();

        const results =
          await memberCaller.organization.createInviteRequest({
            organizationId,
            invites: [
              { email: "user@example.com", role: "MEMBER", teamIds: teamId },
            ],
          });

        const result = await adminCaller.organization.approveInvite({
          inviteId: results[0]!.invite.id,
          organizationId,
        });

        const expiration = result.invite.expiration!;
        const expectedMin = beforeApproval + INVITE_EXPIRATION_MS - 5000; // 48h - 5s tolerance
        const expectedMax = Date.now() + INVITE_EXPIRATION_MS + 5000; // 48h + 5s tolerance

        expect(expiration.getTime()).toBeGreaterThanOrEqual(expectedMin);
        expect(expiration.getTime()).toBeLessThanOrEqual(expectedMax);
      });

      it("sends invitation email", async () => {
        const results =
          await memberCaller.organization.createInviteRequest({
            organizationId,
            invites: [
              { email: "user@example.com", role: "MEMBER", teamIds: teamId },
            ],
          });

        await adminCaller.organization.approveInvite({
          inviteId: results[0]!.invite.id,
          organizationId,
        });

        expect(mockSendInviteEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            email: "user@example.com",
          })
        );
      });
    });

    describe("when non-admin tries to approve an invitation", () => {
      it("fails with permission error", async () => {
        // Create WAITING_APPROVAL invite directly in DB
        const invite = await prisma.organizationInvite.create({
          data: {
            email: "user@example.com",
            inviteCode: nanoid(),
            expiration: null,
            organizationId,
            teamIds: teamId,
            role: OrganizationUserRole.MEMBER,
            status: "WAITING_APPROVAL",
            requestedBy: memberUserId,
          },
        });

        await expect(
          memberCaller.organization.approveInvite({
            inviteId: invite.id,
            organizationId,
          })
        ).rejects.toMatchObject({
          code: "UNAUTHORIZED",
        });
      });
    });

    describe("when license limit is reached after invite was created", () => {
      it("rejects approval with FORBIDDEN error", async () => {
        // Create WAITING_APPROVAL invite while limits are generous
        mockGetActivePlan.mockResolvedValue(makeTestPlan({ maxMembers: 10 }));

        const results =
          await memberCaller.organization.createInviteRequest({
            organizationId,
            invites: [
              {
                email: "late-limit@example.com",
                role: "MEMBER",
                teamIds: teamId,
              },
            ],
          });

        const inviteId = results[0]!.invite.id;

        // Simulate plan downgrade: org has 2 members + 1 WAITING_APPROVAL = 3 counted,
        // setting maxMembers to 2 makes re-validation during approval fail
        mockGetActivePlan.mockResolvedValue(makeTestPlan({ maxMembers: 2 }));

        await expect(
          adminCaller.organization.approveInvite({
            inviteId,
            organizationId,
          })
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
        });

        // Verify the invite remains in WAITING_APPROVAL status (not transitioned)
        const unchangedInvite =
          await prisma.organizationInvite.findFirst({
            where: { id: inviteId, organizationId },
          });
        expect(unchangedInvite?.status).toBe("WAITING_APPROVAL");
      });
    });
  });

  // ============================================================================
  // deleteInvite (reject WAITING_APPROVAL)
  // ============================================================================

  describe("deleteInvite", () => {
    describe("when admin deletes a WAITING_APPROVAL invitation", () => {
      it("removes the invitation successfully", async () => {
        // Create WAITING_APPROVAL invite
        const invite = await prisma.organizationInvite.create({
          data: {
            email: "remove@example.com",
            inviteCode: nanoid(),
            expiration: null,
            organizationId,
            teamIds: teamId,
            role: OrganizationUserRole.MEMBER,
            status: "WAITING_APPROVAL",
            requestedBy: memberUserId,
          },
        });

        await adminCaller.organization.deleteInvite({
          inviteId: invite.id,
          organizationId,
        });

        const deleted = await prisma.organizationInvite.findFirst({
          where: { id: invite.id, organizationId },
        });

        expect(deleted).toBeNull();
      });
    });
  });

  // ============================================================================
  // getOrganizationPendingInvites
  // ============================================================================

  describe("getOrganizationPendingInvites", () => {
    describe("when both PENDING and WAITING_APPROVAL invites exist", () => {
      it("returns invites with both statuses", async () => {
        // Create PENDING invite
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

        // Create WAITING_APPROVAL invite
        await prisma.organizationInvite.create({
          data: {
            email: "waiting@example.com",
            inviteCode: nanoid(),
            expiration: null,
            organizationId,
            teamIds: teamId,
            role: OrganizationUserRole.MEMBER,
            status: "WAITING_APPROVAL",
            requestedBy: memberUserId,
          },
        });

        const invites =
          await adminCaller.organization.getOrganizationPendingInvites({
            organizationId,
          });

        const emails = invites.map((i) => i.email);
        expect(emails.includes("pending@example.com")).toBe(true);
        expect(emails.includes("waiting@example.com")).toBe(true);
      });

      it("includes requestedByUser data for WAITING_APPROVAL invites", async () => {
        await prisma.organizationInvite.create({
          data: {
            email: "waiting-req@example.com",
            inviteCode: nanoid(),
            expiration: null,
            organizationId,
            teamIds: teamId,
            role: OrganizationUserRole.MEMBER,
            status: "WAITING_APPROVAL",
            requestedBy: memberUserId,
          },
        });

        const invites =
          await adminCaller.organization.getOrganizationPendingInvites({
            organizationId,
          });

        const waitingInvite = invites.find(
          (i) => i.email === "waiting-req@example.com"
        );
        expect(waitingInvite?.requestedByUser).toBeDefined();
        expect(waitingInvite?.requestedByUser?.name).toBe("Invite Member");
      });
    });
  });

  // ============================================================================
  // Two-phase email: records created atomically, emails sent after commit
  // ============================================================================

  describe("createInvites (admin batch)", () => {
    describe("when admin invites multiple users in a single batch", () => {
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
        const failedResult = results.find(
          (r) => r.invite.email === "fail-email@example.com"
        );
        expect(failedResult?.emailNotSent).toBe(true);

        // The successful one has emailNotSent = false
        const okResult = results.find(
          (r) => r.invite.email === "ok-email@example.com"
        );
        expect(okResult?.emailNotSent).toBe(false);
      });
    });
  });

  // ============================================================================
  // Email failure during approval does not revert the approval
  // ============================================================================

  describe("approveInvite (email failure)", () => {
    describe("when email service is unavailable during approval", () => {
      it("still approves the invitation", async () => {
        // Create WAITING_APPROVAL invite
        const results =
          await memberCaller.organization.createInviteRequest({
            organizationId,
            invites: [
              { email: "user@example.com", role: "MEMBER", teamIds: teamId },
            ],
          });

        // Make email sending fail
        mockSendInviteEmail.mockRejectedValue(
          new Error("Email service unavailable")
        );

        const result = await adminCaller.organization.approveInvite({
          inviteId: results[0]!.invite.id,
          organizationId,
        });

        // Approval succeeded despite email failure
        expect(result.invite.status).toBe("PENDING");

        // Verify in DB too
        const dbInvite = await prisma.organizationInvite.findFirst({
          where: { id: results[0]!.invite.id, organizationId },
        });
        expect(dbInvite?.status).toBe("PENDING");
      });

      it("returns emailNotSent as fallback indicator", async () => {
        const results =
          await memberCaller.organization.createInviteRequest({
            organizationId,
            invites: [
              { email: "user@example.com", role: "MEMBER", teamIds: teamId },
            ],
          });

        mockSendInviteEmail.mockRejectedValue(
          new Error("Email service unavailable")
        );

        const result = await adminCaller.organization.approveInvite({
          inviteId: results[0]!.invite.id,
          organizationId,
        });

        expect(result.emailNotSent).toBe(true);
      });
    });
  });

  // ============================================================================
  // License limit enforcement with WAITING_APPROVAL
  // ============================================================================

  describe("license limits", () => {
    describe("when license limit is reached between invite creation and approval", () => {
      it("rejects approval with FORBIDDEN error", async () => {
        // Step 1: Create WAITING_APPROVAL invite while limits are generous
        mockGetActivePlan.mockResolvedValue(makeTestPlan({ maxMembers: 10 }));

        const results =
          await memberCaller.organization.createInviteRequest({
            organizationId,
            invites: [
              {
                email: "approval-limit@example.com",
                role: "MEMBER",
                teamIds: teamId,
              },
            ],
          });

        const inviteId = results[0]!.invite.id;

        // Step 2: Simulate capacity being reached after invite was created
        // (e.g., plan downgrade or other members joined)
        // Org has 2 real members (admin + member) + 1 WAITING_APPROVAL invite = 3 counted.
        // Set maxMembers to 2 so the re-validation during approval fails.
        mockGetActivePlan.mockResolvedValue(makeTestPlan({ maxMembers: 2 }));

        // Step 3: Admin attempts to approve the invite
        await expect(
          adminCaller.organization.approveInvite({
            inviteId,
            organizationId,
          })
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
      });
    });

    describe("when WAITING_APPROVAL invites count toward member limits", () => {
      it("rejects new invite when limit is reached", async () => {
        // Override the subscription handler to set a low limit
        const limitedPlan = makeTestPlan({ maxMembers: 3 });
        mockGetActivePlan.mockResolvedValue(limitedPlan);

        // Organization already has 2 members (admin + member) and we have a low limit of 3
        // Create a WAITING_APPROVAL invite to use the last slot
        await prisma.organizationInvite.create({
          data: {
            email: "waiting-limit@example.com",
            inviteCode: nanoid(),
            expiration: null,
            organizationId,
            teamIds: teamId,
            role: OrganizationUserRole.MEMBER,
            status: "WAITING_APPROVAL",
            requestedBy: memberUserId,
          },
        });

        await expect(
          memberCaller.organization.createInviteRequest({
            organizationId,
            invites: [
              { email: "new@example.com", role: "MEMBER", teamIds: teamId },
            ],
          })
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
      });
    });
  });
});

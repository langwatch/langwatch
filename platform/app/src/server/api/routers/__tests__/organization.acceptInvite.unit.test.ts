/**
 * Unit tests for acceptInvite status guard.
 *
 * Regression tests for #450: acceptInvite must require status === "PENDING"
 * before applying the invite. Non-PENDING statuses (PAYMENT_PENDING,
 * WAITING_APPROVAL) must be rejected with BAD_REQUEST.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  INVITE_ALREADY_ACCEPTED_MESSAGE,
  INVITE_NOT_READY_MESSAGE,
} from "../../../invites/errors";
import { createInnerTRPCContext } from "../../trpc";
import { organizationRouter } from "../organization";

vi.mock("../../../../env.mjs", () => ({
  env: {
    SENDGRID_API_KEY: "test-key",
    BASE_HOST: "http://localhost:3000",
  },
}));

vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

// PersonalWorkspaceService.ensure() is hooked into acceptInvite (since
// 651e0c1b2) and runs outside the invite tx for fault isolation. The
// service opens its own Prisma transaction and walks Team/Project
// findFirst+create methods that this test's invite-shape tx mock
// doesn't provide. We stub the ensure() call at the test boundary —
// the unit's purpose is acceptInvite status-guard behaviour, not
// personal-workspace internals (those have their own integration
// test at personalWorkspace.service.integration.test.ts).
// Path must match the import in organization.ts (`@ee/governance/services/...`).
// Vite-test resolves @ee via tsconfig paths; using the same specifier here ensures
// vi.mock hooks the actual module the router imports, not a sibling under src/.
vi.mock("@ee/governance/services/personalWorkspace.service", () => ({
  PersonalWorkspaceService: class {
    constructor(_prisma: unknown) {}
    async ensure(_args: unknown) {
      return {
        team: { id: "stub-team", isPersonal: true, ownerUserId: "user-1" },
        project: {
          id: "stub-project",
          isPersonal: true,
          ownerUserId: "user-1",
        },
        created: false,
      };
    }
  },
}));

// The invite's grants are ledger commands (ADR-092 delivery-plan PR 2).
const ledger = vi.hoisted(() => ({
  attachBindings: vi.fn(),
  revokeBindings: vi.fn(),
  revokeBindingsWhere: vi.fn(),
  defineRole: vi.fn(),
  deleteRole: vi.fn(),
}));
vi.mock("~/server/app-layer/authz/ledger", () => ({
  grantsLedgerWriter: () => ledger,
}));

vi.mock("../../../app-layer/app", () => ({
  // Consumers that degrade without Redis read through this one.
  tryGetApp: () => null,
  getApp: () => ({
    notifications: {
      sendSlackSignupEvent: vi.fn().mockResolvedValue(undefined),
    },
    nurturing: null,
  }),
}));

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    skipPermissionCheck: ({ ctx, next }: any) => {
      ctx.permissionChecked = true;
      return next();
    },
    hasOrganizationPermission: vi.fn().mockResolvedValue(true),
    resolveTeamPermission: vi
      .fn()
      .mockResolvedValue({ permitted: true, organizationRole: "MEMBER" }),
  };
});

function makeInvite(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    email: "user@example.com",
    inviteCode: "test-code",
    status: "PENDING",
    expiration: new Date(Date.now() + 86400000),
    organizationId: "org-1",
    teamIds: "team-1",
    teamAssignments: null,
    role: "MEMBER",
    requestedBy: null,
    subscriptionId: null,
    organization: { id: "org-1", name: "Test Org" },
    ...overrides,
  };
}

describe("organization.acceptInvite", () => {
  let findUniqueMock: ReturnType<typeof vi.fn>;
  let inviteUpdateMock: ReturnType<typeof vi.fn>;
  let createManyMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    ledger.attachBindings.mockResolvedValue({ attached: [], duplicates: [] });
    ledger.revokeBindingsWhere.mockResolvedValue(0);
    findUniqueMock = vi.fn();
    inviteUpdateMock = vi.fn().mockResolvedValue({ count: 1 });
    createManyMock = vi.fn().mockResolvedValue({ count: 1 });
  });

  function createCaller(email = "user@example.com") {
    const ctx = createInnerTRPCContext({
      session: {
        user: { id: "user-1", name: "Test User", email },
        expires: "2099-01-01",
      },
    });
    const prismaStub: any = {
      // Acceptance and the membership row land in one transaction, and the
      // service refuses to run on somebody else's: `$connect` is what marks
      // this stub as the root client it stands in for. The claim runs the
      // callback form of `$transaction`, handing the stub back as `tx`.
      $connect: vi.fn(),
      $transaction: (arg: unknown) =>
        typeof arg === "function"
          ? (arg as (tx: unknown) => unknown)(prismaStub)
          : Promise.all(arg as Promise<unknown>[]),
      organizationInvite: {
        findUnique: findUniqueMock,
        updateMany: inviteUpdateMock,
        findFirst: vi.fn().mockResolvedValue(null),
      },
      organizationUser: { createMany: createManyMock },
      project: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    (ctx as any).prisma = prismaStub;
    return organizationRouter.createCaller(ctx);
  }

  describe("when invite status is PENDING", () => {
    it("proceeds to apply the invite", async () => {
      findUniqueMock.mockResolvedValue(makeInvite({ status: "PENDING" }));

      const caller = createCaller();
      const result = await caller.acceptInvite({ inviteCode: "test-code" });

      expect(result.success).toBe(true);
      // The membership row and the acceptance land in one transaction, and
      // the grants the invite carries follow it: they are ledger commands and
      // cannot join, and this order is what keeps a PENDING invite from ever
      // carrying access somebody could revoke out from under. The ordering
      // assertion is the point: a grant emitted before the membership row
      // lands would attach access to someone who is not yet a member.
      expect(createManyMock).toHaveBeenCalledTimes(1);
      expect(ledger.attachBindings).toHaveBeenCalled();
      expect(createManyMock.mock.invocationCallOrder[0]!).toBeLessThan(
        ledger.attachBindings.mock.invocationCallOrder[0]!,
      );
      // The claim is conditional on the (status, inviteCode) pair the caller
      // read — that is what makes two racers on one PENDING invite unable to
      // both win — and it records who accepted.
      expect(inviteUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: "PENDING",
            inviteCode: "test-code",
          }),
          data: {
            status: "ACCEPTED",
            acceptedByUserId: "user-1",
            acceptedViaIdentifierId: null,
          },
        }),
      );
      // The ACCEPTED claim rides the same transaction as the membership row,
      // and the ledger grant is emitted only once that transaction has
      // committed — so the claim must be ordered before the grant just like
      // the membership row is.
      expect(inviteUpdateMock.mock.invocationCallOrder[0]!).toBeLessThan(
        ledger.attachBindings.mock.invocationCallOrder[0]!,
      );
    });
  });

  describe("when invite status is PAYMENT_PENDING", () => {
    it("rejects with BAD_REQUEST", async () => {
      findUniqueMock.mockResolvedValue(
        makeInvite({ status: "PAYMENT_PENDING", expiration: null }),
      );

      const caller = createCaller();

      await expect(
        caller.acceptInvite({ inviteCode: "test-code" }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: INVITE_NOT_READY_MESSAGE,
      });
    });

    it("applies nothing", async () => {
      findUniqueMock.mockResolvedValue(
        makeInvite({ status: "PAYMENT_PENDING", expiration: null }),
      );

      const caller = createCaller();

      await caller.acceptInvite({ inviteCode: "test-code" }).catch(() => {});

      expect(ledger.attachBindings).not.toHaveBeenCalled();
      expect(inviteUpdateMock).not.toHaveBeenCalled();
    });
  });

  describe("when invite status is WAITING_APPROVAL", () => {
    it("rejects with BAD_REQUEST", async () => {
      findUniqueMock.mockResolvedValue(
        makeInvite({ status: "WAITING_APPROVAL", expiration: null }),
      );

      const caller = createCaller();

      await expect(
        caller.acceptInvite({ inviteCode: "test-code" }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: INVITE_NOT_READY_MESSAGE,
      });
    });

    it("applies nothing", async () => {
      findUniqueMock.mockResolvedValue(
        makeInvite({ status: "WAITING_APPROVAL", expiration: null }),
      );

      const caller = createCaller();

      await caller.acceptInvite({ inviteCode: "test-code" }).catch(() => {});

      expect(ledger.attachBindings).not.toHaveBeenCalled();
      expect(inviteUpdateMock).not.toHaveBeenCalled();
    });
  });

  describe("when invite status is ACCEPTED", () => {
    it("rejects with the already-accepted message", async () => {
      findUniqueMock.mockResolvedValue(makeInvite({ status: "ACCEPTED" }));

      const caller = createCaller();

      await expect(
        caller.acceptInvite({ inviteCode: "test-code" }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: INVITE_ALREADY_ACCEPTED_MESSAGE,
      });
    });
  });
});

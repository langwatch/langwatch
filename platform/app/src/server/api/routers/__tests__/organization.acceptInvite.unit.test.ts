/**
 * Unit tests for acceptInvite status guard.
 *
 * Regression tests for #450: acceptInvite must require status === "PENDING"
 * before applying the invite. Non-PENDING statuses (PAYMENT_PENDING, and the
 * retired WAITING_APPROVAL enum value no live row carries any more) must be
 * rejected with BAD_REQUEST.
 */
import { memoryAdapter } from "better-auth/adapters/memory";
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

vi.mock("~/runtime/app/features/audit-log", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

// Identifier-aware acceptance (D11): the router asks the identity runtime
// for the user's verified addresses. `null` = not on identifiers, keep the
// legacy session-email comparison — the default here so the pre-identifier
// tests exercise exactly the legacy branch.
const verifiedEmailsOfMock = vi.hoisted(() => vi.fn().mockResolvedValue(null));
vi.mock("~/server/app-layer/identity/runtime", () => ({
  identityEmail: () => ({ verifiedEmailsOf: verifiedEmailsOfMock }),
  // `betterAuth()` builds its adapter EAGERLY at module load, and this
  // suite's import graph reaches it through the router. It has to be real
  // enough to initialise; better-auth's own memory engine over an empty
  // store is exactly that, and holds nothing this suite could assert
  // against by accident.
  identityStorageAdapter: () => memoryAdapter({}),
}));

// The invite's grants are ledger commands (ADR-092 delivery-plan PR 2).
const ledger = vi.hoisted(() => ({
  attachBindings: vi.fn(),
  revokeBindings: vi.fn(),
  revokeBindingsWhere: vi.fn(),
  defineRole: vi.fn(),
  deleteRole: vi.fn(),
}));
vi.mock("../../../app-layer/app", () => ({
  // Consumers that degrade without Redis read through this one.
  tryGetApp: () => null,
  getApp: () => ({
    organizations: {
      ensurePersonalWorkspace: vi.fn().mockResolvedValue({
        team: { id: "stub-team" },
        project: { id: "stub-project" },
        created: false,
      }),
    },
    authzGrants: ledger,
    // The scope-lineage guard runs ahead of every resolver and reads this.
    permissions: {
      checkScopeLineage: vi.fn().mockResolvedValue({ kind: "consistent" }),
    },
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
    inviteUpdateMock = vi.fn().mockResolvedValue(makeInvite({ status: "ACCEPTED" }));
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

  describe("when the signed-in user is on identifiers", () => {
    /** @scenario "Acceptance requires verification and an exact normalized match" */
    it("accepts through any verified identifier matching the invite's normalized address", async () => {
      // The invite targets the work address with the admin's casing; the user
      // is signed in as their personal email, but a VERIFIED Google identifier
      // holds the work address. Casing folds away, and the plus tag does NOT:
      // it is part of the address, so the identifier has to hold the same one
      // the invite named.
      findUniqueMock.mockResolvedValue(
        makeInvite({ status: "PENDING", email: "Sam.J+team@Acme.com" }),
      );
      verifiedEmailsOfMock.mockResolvedValueOnce([
        {
          identifierId: "idf_g",
          value: "sam.j+team@acme.com",
          provider: "google",
        },
      ]);

      const caller = createCaller("sam@personal.net");
      const result = await caller.acceptInvite({ inviteCode: "test-code" });

      expect(result.success).toBe(true);
      // The claim records which identifier vouched for the acceptance.
      expect(inviteUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            acceptedViaIdentifierId: "idf_g",
          }),
        }),
      );
    });

    it("refuses when no verified identifier holds the invited address", async () => {
      // The session email HAPPENS to equal the invite's address, but for a
      // user on identifiers the proven set is the authority — an address
      // nothing verified never opens an invitation.
      findUniqueMock.mockResolvedValue(
        makeInvite({ status: "PENDING", email: "user@example.com" }),
      );
      verifiedEmailsOfMock.mockResolvedValueOnce([
        { identifierId: "idf_o", value: "other@acme.com", provider: "email" },
      ]);

      const caller = createCaller();
      await expect(
        caller.acceptInvite({ inviteCode: "test-code" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(createManyMock).not.toHaveBeenCalled();
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

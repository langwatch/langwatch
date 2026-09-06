import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GrantsLedgerWriter } from "~/server/app-layer/authz/ledger";
import { InviteNotFoundError } from "../errors";
import { InviteService, resolveInviteDisplayStatus } from "../invite.service";

/**
 * D11 — resilient invitations (specs/identity/resilient-invitations.feature).
 * The claim discipline and the visible states, at the service layer.
 */

const ledger = {
  attachBindings: vi.fn(),
  revokeBindingsWhere: vi.fn(),
};

function makePendingInvite(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-race-1",
    email: "sam@acme.com",
    inviteCode: "code-race-1",
    status: "PENDING",
    expiration: new Date(Date.now() + 86400000),
    organizationId: "org-1",
    teamIds: "team-1",
    teamAssignments: null,
    role: "MEMBER",
    requestedBy: "user-inviter",
    subscriptionId: null,
  } as any;
}

describe("InviteService resilience", () => {
  let mockPrisma: any;
  let service: InviteService;

  beforeEach(() => {
    ledger.attachBindings.mockReset();
    ledger.revokeBindingsWhere.mockReset();
    ledger.attachBindings.mockResolvedValue({ attached: [], duplicates: [] });
    ledger.revokeBindingsWhere.mockResolvedValue(0);

    mockPrisma = {
      $connect: vi.fn(),
      $transaction: (arg: unknown) =>
        typeof arg === "function"
          ? (arg as (tx: unknown) => unknown)(mockPrisma)
          : Promise.all(arg as Promise<unknown>[]),
      organizationInvite: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      organizationUser: {
        createMany: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
      },
      organization: { findFirst: vi.fn() },
      customRole: { findMany: vi.fn() },
    };

    service = new InviteService(
      mockPrisma,
      { getMemberCount: vi.fn(), getMembersLiteCount: vi.fn() } as any,
      { getActivePlan: vi.fn() } as any,
      undefined,
      ledger as unknown as GrantsLedgerWriter,
    );
  });

  describe("given two acceptance attempts hold the same PENDING invite", () => {
    describe("when both try to claim the row", () => {
      /** @scenario "Two racers on one invitation cannot both win" */
      it("refuses the loser with a stale-code refusal and writes them no membership", async () => {
        // The loser's conditional claim matches nothing: the winner's
        // transaction already moved the row off (PENDING, code-race-1).
        mockPrisma.organizationInvite.updateMany.mockResolvedValue({
          count: 0,
        });
        mockPrisma.organizationInvite.findUnique.mockResolvedValue({
          status: "ACCEPTED",
        });
        // The loser is a different person: they hold no membership, so the
        // claim failure is not their own retry to repair.
        mockPrisma.organizationUser.findUnique.mockResolvedValue(null);

        await expect(
          service.applyInvite({
            userId: "user-loser",
            invite: makePendingInvite(),
          }),
        ).rejects.toBeInstanceOf(InviteNotFoundError);

        expect(mockPrisma.organizationUser.createMany).not.toHaveBeenCalled();
        expect(ledger.attachBindings).not.toHaveBeenCalled();
      });

      it("repairs instead of refusing when the loser is the winner racing itself", async () => {
        mockPrisma.organizationInvite.updateMany.mockResolvedValue({
          count: 0,
        });
        mockPrisma.organizationInvite.findUnique.mockResolvedValue({
          status: "ACCEPTED",
        });
        mockPrisma.organizationUser.findUnique.mockResolvedValue({
          userId: "user-winner",
        });

        await service.applyInvite({
          userId: "user-winner",
          invite: makePendingInvite(),
        });

        expect(ledger.attachBindings).toHaveBeenCalled();
      });
    });
  });

  describe("given an admin revokes an invitation", () => {
    describe("when the revocation runs", () => {
      /** @scenario "A revoked invitation ends the journey quietly" */
      it("keeps the row as a REVOKED state instead of deleting it", async () => {
        mockPrisma.organizationInvite.updateMany.mockResolvedValue({
          count: 1,
        });

        await service.revokeInvite({
          organizationId: "org-1",
          inviteId: "inv-race-1",
        });

        expect(mockPrisma.organizationInvite.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              id: "inv-race-1",
              organizationId: "org-1",
            }),
            data: { status: "REVOKED" },
          }),
        );
      });

      it("refuses to revoke an invitation that was already accepted", async () => {
        mockPrisma.organizationInvite.updateMany.mockResolvedValue({
          count: 0,
        });

        await expect(
          service.revokeInvite({
            organizationId: "org-1",
            inviteId: "inv-accepted",
          }),
        ).rejects.toBeInstanceOf(InviteNotFoundError);
      });
    });
  });

  describe("given an expired invitation the inviter resends", () => {
    beforeEach(() => {
      mockPrisma.organizationInvite.findFirst.mockResolvedValue({
        ...makePendingInvite(),
        expiration: new Date(Date.now() - 1000),
        organization: { id: "org-1", name: "Acme" },
      });
    });

    describe("when the resend runs", () => {
      /** @scenario "A leaked stale link dies on resend" */
      it("claims the row on the code it read and mints a fresh one", async () => {
        mockPrisma.organizationInvite.updateMany.mockResolvedValue({
          count: 1,
        });

        const { invite } = await service.resendInvite({
          organizationId: "org-1",
          inviteId: "inv-race-1",
        });

        // The claim names the OLD code — that conditionality is what makes
        // the rotation a revocation: after it lands, the old link matches
        // no row anywhere.
        expect(mockPrisma.organizationInvite.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              status: "PENDING",
              inviteCode: "code-race-1",
            }),
            data: expect.objectContaining({
              inviteCode: expect.not.stringMatching(/^code-race-1$/),
              expiration: expect.any(Date),
            }),
          }),
        );
        expect(invite.inviteCode).not.toBe("code-race-1");
        expect(invite.expiration!.getTime()).toBeGreaterThan(
          Date.now() + 13 * 24 * 60 * 60 * 1000,
        );
      });

      it("loses quietly when another admin's resend claimed the row first", async () => {
        mockPrisma.organizationInvite.updateMany.mockResolvedValue({
          count: 0,
        });

        await expect(
          service.resendInvite({
            organizationId: "org-1",
            inviteId: "inv-race-1",
          }),
        ).rejects.toBeInstanceOf(InviteNotFoundError);
      });

      it("refuses to resend a revoked invitation", async () => {
        mockPrisma.organizationInvite.findFirst.mockResolvedValue({
          ...makePendingInvite(),
          status: "REVOKED",
          organization: { id: "org-1", name: "Acme" },
        });

        await expect(
          service.resendInvite({
            organizationId: "org-1",
            inviteId: "inv-race-1",
          }),
        ).rejects.toBeInstanceOf(InviteNotFoundError);
        expect(mockPrisma.organizationInvite.updateMany).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the states a person sees", () => {
    describe("when an invitation's expiry has passed", () => {
      it("derives EXPIRED from a PENDING row past its expiration", () => {
        const past = new Date(Date.now() - 1000);
        expect(
          resolveInviteDisplayStatus({ status: "PENDING", expiration: past }),
        ).toBe("EXPIRED");
      });

      it("leaves every other state alone", () => {
        const past = new Date(Date.now() - 1000);
        const future = new Date(Date.now() + 1000);
        expect(
          resolveInviteDisplayStatus({ status: "PENDING", expiration: future }),
        ).toBe("PENDING");
        expect(
          resolveInviteDisplayStatus({ status: "PENDING", expiration: null }),
        ).toBe("PENDING");
        expect(
          resolveInviteDisplayStatus({ status: "ACCEPTED", expiration: past }),
        ).toBe("ACCEPTED");
        expect(
          resolveInviteDisplayStatus({ status: "REVOKED", expiration: past }),
        ).toBe("REVOKED");
      });
    });
  });
});

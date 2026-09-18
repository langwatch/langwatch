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
      role: { findMany: vi.fn() },
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

  /**
   * The shared `makePendingInvite` accepts overrides and ignores them, so
   * these cases build their own row rather than appearing to vary one.
   */
  const invitation = (overrides: Record<string, unknown> = {}) => ({
    ...makePendingInvite(),
    ...overrides,
  });

  /**
   * EXTEND IS NOT RESEND. Both keep an invitation usable and only one of them
   * kills the link already out there. The distinction is load-bearing
   * precisely because it is invisible from the members list, where both show
   * as "pending, expires on ...".
   *
   * Spec: specs/identity/resilient-invitations.feature,
   *       "Buying time without minting a link".
   */
  describe("given a pending invitation whose deadline is near", () => {
    describe("when an administrator extends it", () => {
      /** @scenario "Extending an invitation moves the deadline and leaves the link alone" */
      it("moves the deadline the full fourteen days and mints no new code", async () => {
        const existing = invitation({
          expiration: new Date(Date.now() + 60_000),
        });
        mockPrisma.organizationInvite.findFirst.mockResolvedValue(existing);
        mockPrisma.organizationInvite.updateMany.mockResolvedValue({
          count: 1,
        });

        const { invite } = await service.extendInvite({
          organizationId: "org-1",
          inviteId: existing.id,
        });

        const written =
          mockPrisma.organizationInvite.updateMany.mock.calls[0]?.[0]?.data;
        // The whole point: the code is untouched, so the link in somebody's
        // inbox goes on working and nothing has to be sent again.
        expect(written).not.toHaveProperty("inviteCode");
        expect(invite.inviteCode).toBe(existing.inviteCode);
        expect(written.expiration.getTime()).toBeGreaterThan(
          existing.expiration.getTime(),
        );
      });

      /** @scenario "Extending is not how a leaked link is dealt with" */
      it("writes no code at all, so whatever leaked goes on working", async () => {
        const existing = invitation();
        mockPrisma.organizationInvite.findFirst.mockResolvedValue(existing);
        mockPrisma.organizationInvite.updateMany.mockResolvedValue({
          count: 1,
        });

        const { invite } = await service.extendInvite({
          organizationId: "org-1",
          inviteId: existing.id,
        });

        // Rotating the code is what kills a leaked link, and extending does
        // not do it — the contrast is covered by "A leaked stale link dies on
        // resend", which owns the resend half.
        const written =
          mockPrisma.organizationInvite.updateMany.mock.calls[0]?.[0]?.data;
        expect(Object.keys(written)).toEqual(["expiration"]);
        expect(invite.inviteCode).toBe(existing.inviteCode);
      });
    });

    describe("when the invitation is no longer waiting", () => {
      /** @scenario "Only an invitation still waiting can be extended" */
      it("answers as though there were no such invitation, whichever ending it had", async () => {
        mockPrisma.organizationInvite.updateMany.mockResolvedValue({
          count: 1,
        });
        for (const status of ["ACCEPTED", "REVOKED", "EXPIRED"]) {
          mockPrisma.organizationInvite.findFirst.mockResolvedValue(
            invitation({ status }),
          );

          await expect(
            service.extendInvite({
              organizationId: "org-1",
              inviteId: "inv-race-1",
            }),
          ).rejects.toBeInstanceOf(InviteNotFoundError);
        }
        // Nothing was written for any of the three, and none of them is
        // distinguishable from an id that never existed.
        expect(mockPrisma.organizationInvite.updateMany).not.toHaveBeenCalled();
      });
    });

    describe("when two administrators extend it at the same moment", () => {
      /** @scenario "Two administrators extending at once extend it once" */
      it("refuses the second rather than letting it overwrite the first", async () => {
        mockPrisma.organizationInvite.findFirst.mockResolvedValue(invitation());
        // The row moved between the read and the write, so the conditional
        // claim matches nothing.
        mockPrisma.organizationInvite.updateMany.mockResolvedValue({
          count: 0,
        });

        await expect(
          service.extendInvite({
            organizationId: "org-1",
            inviteId: "inv-race-1",
          }),
        ).rejects.toBeInstanceOf(InviteNotFoundError);
      });
    });
  });
});

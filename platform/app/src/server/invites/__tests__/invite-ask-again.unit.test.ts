import { beforeEach, describe, expect, it, vi } from "vitest";
import { InviteNotFoundError, InviteThrottledError } from "../errors";
import { InviteService, maskInvitedAddress } from "../invite.service";
import { assertInviteSendAllowed } from "../invite-send-throttle";

/**
 * D11 — the wrong account, and asking again
 * (specs/identity/resilient-invitations.feature).
 *
 * The mask, the shared send throttle, and the invitee's ask for a fresh
 * invitation. All three are pure enough to run with no datastore: the ask
 * reaches Prisma and the mailer through mocks.
 */

const sendInviteReRequestEmail = vi.hoisted(() => vi.fn());
vi.mock("../../mailer/inviteReRequestEmail", () => ({
  sendInviteReRequestEmail,
}));

describe("given an invitation whose holder is signed in as somebody else", () => {
  describe("when the invited address is shown back to them", () => {
    /** @scenario The hint recognizes the address without spelling it out */
    it("keeps the domain and the first character, and hides the rest", () => {
      expect(maskInvitedAddress("sam@acme.com")).toBe("s•••@acme.com");
      expect(maskInvitedAddress("alexander@big-company.co.uk")).toBe(
        "a•••@big-company.co.uk",
      );
    });

    /** @scenario The hint recognizes the address without spelling it out */
    it("never lets the local part through whole", () => {
      const masked = maskInvitedAddress("sam@acme.com");

      expect(masked).not.toContain("sam");
      expect(masked.startsWith("s•••@")).toBe(true);
    });

    it("masks a value it cannot parse as an address entirely", () => {
      expect(maskInvitedAddress("not-an-address")).toBe("•••");
      expect(maskInvitedAddress("@acme.com")).toBe("•••");
      expect(maskInvitedAddress("sam@")).toBe("•••");
    });

    it("reveals nothing further for a single-character local part", () => {
      expect(maskInvitedAddress("s@acme.com")).toBe("s•••@acme.com");
    });
  });
});

describe("given one invitation and the two routes that mail it", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T12:00:00Z"));
  });

  describe("when it is sent its fill within the window", () => {
    /** @scenario Resending is throttled per invitation */
    it("refuses the next one and says how long to wait", async () => {
      const inviteId = `inv-throttle-${Math.random()}`;

      await assertInviteSendAllowed({ inviteId });
      await assertInviteSendAllowed({ inviteId });
      await assertInviteSendAllowed({ inviteId });

      await expect(
        assertInviteSendAllowed({ inviteId }),
      ).rejects.toBeInstanceOf(InviteThrottledError);
    });

    /** @scenario Resending is throttled per invitation */
    it("throttles each invitation on its own counter", async () => {
      const first = `inv-alone-a-${Math.random()}`;
      const second = `inv-alone-b-${Math.random()}`;

      await assertInviteSendAllowed({ inviteId: first });
      await assertInviteSendAllowed({ inviteId: first });
      await assertInviteSendAllowed({ inviteId: first });

      await expect(
        assertInviteSendAllowed({ inviteId: second }),
      ).resolves.toBeUndefined();
    });

    it("names the seconds left so the screen can say how long", async () => {
      const inviteId = `inv-retry-after-${Math.random()}`;
      for (let i = 0; i < 3; i++) await assertInviteSendAllowed({ inviteId });

      const refusal = await assertInviteSendAllowed({ inviteId }).catch(
        (error: unknown) => error,
      );

      expect(refusal).toBeInstanceOf(InviteThrottledError);
      expect(
        (refusal as InviteThrottledError).meta.retryAfterSeconds,
      ).toBeGreaterThan(0);
    });
  });
});

describe("given an expired invitation", () => {
  const expired = {
    id: "inv-expired-1",
    email: "sam@acme.com",
    inviteCode: "code-expired-1",
    status: "PENDING",
    expiration: new Date("2026-08-01T00:00:00Z"),
    organizationId: "org-1",
    organization: { name: "Acme", slug: "acme" },
  };

  let prisma: any;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T12:00:00Z"));
    sendInviteReRequestEmail.mockReset();
    sendInviteReRequestEmail.mockResolvedValue(undefined);
    prisma = {
      organizationInvite: { findUnique: vi.fn().mockResolvedValue(expired) },
      organizationUser: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { user: { email: "ana@acme.com" } },
            { user: { email: "avery@acme.com" } },
          ]),
      },
    };
  });

  describe("when its holder asks for a fresh one", () => {
    /** @scenario The invitee can ask for a fresh invitation when theirs expired */
    it("tells every admin who can send one", async () => {
      const service = InviteService.create(prisma);

      const result = await service.requestFreshInvite({
        inviteCode: "code-expired-1",
        membersSettingsUrl: "https://app.langwatch.ai/settings/members",
      });

      expect(result.notifiedAdmins).toBe(2);
      expect(sendInviteReRequestEmail).toHaveBeenCalledTimes(2);
      expect(prisma.organizationUser.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: "org-1", role: "ADMIN" },
        }),
      );
    });

    /** @scenario The invitee can ask for a fresh invitation when theirs expired */
    it("mints nothing — no code is rotated and no invitation is written", async () => {
      const service = InviteService.create(prisma);

      await service.requestFreshInvite({
        inviteCode: "code-expired-1",
        membersSettingsUrl: "https://app.langwatch.ai/settings/members",
      });

      expect(prisma.organizationInvite.update).toBeUndefined();
      expect(prisma.organizationInvite.updateMany).toBeUndefined();
    });

    it("still tells the reachable admins when one address fails", async () => {
      sendInviteReRequestEmail
        .mockRejectedValueOnce(new Error("bounced"))
        .mockResolvedValueOnce(undefined);
      const service = InviteService.create(prisma);

      const result = await service.requestFreshInvite({
        inviteCode: "code-expired-1",
        membersSettingsUrl: "https://app.langwatch.ai/settings/members",
      });

      expect(result.notifiedAdmins).toBe(1);
    });
  });

  describe("when the invitation has not actually expired", () => {
    /** @scenario The invitee can ask for a fresh invitation when theirs expired */
    it("answers like a missing one, so the ask cannot probe a code's state", async () => {
      prisma.organizationInvite.findUnique.mockResolvedValue({
        ...expired,
        expiration: new Date("2026-09-30T00:00:00Z"),
      });
      const service = InviteService.create(prisma);

      await expect(
        service.requestFreshInvite({
          inviteCode: "code-expired-1",
          membersSettingsUrl: "https://app.langwatch.ai/settings/members",
        }),
      ).rejects.toBeInstanceOf(InviteNotFoundError);
      expect(sendInviteReRequestEmail).not.toHaveBeenCalled();
    });
  });

  describe("when the invitation was revoked", () => {
    it("answers like a missing one", async () => {
      prisma.organizationInvite.findUnique.mockResolvedValue({
        ...expired,
        status: "REVOKED",
      });
      const service = InviteService.create(prisma);

      await expect(
        service.requestFreshInvite({
          inviteCode: "code-expired-1",
          membersSettingsUrl: "https://app.langwatch.ai/settings/members",
        }),
      ).rejects.toBeInstanceOf(InviteNotFoundError);
      expect(sendInviteReRequestEmail).not.toHaveBeenCalled();
    });
  });
});

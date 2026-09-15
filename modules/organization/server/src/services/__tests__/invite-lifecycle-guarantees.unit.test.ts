/**
 * @see modules/organization/specs/invitations.feature
 * Two guarantees `InviteLifecycleService` makes outside the accept path itself: a re-request
 * cannot be used to flood one address, and approving a subscription's payment-pending invites
 * hands out the seats the customer actually paid for.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { InviteThrottledError } from "@langwatch/organization-contract";
import { InviteLifecycleService } from "../invite-lifecycle.service.ts";
import { InviteSendThrottleService } from "../invite-send-throttle.service.ts";
import {
  FakeInviteMail,
  FakeInviteRateLimit,
  FakeOrganizationInviteRepository,
  makeInvite,
  makeInviteDeps,
  makeOrganization,
} from "./support/invite-fakes.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("given an invitation already sent its fill of re-requests for this window", () => {
  describe("when its holder asks for a fresh one again", () => {
    /** @scenario "Repeated invitation sends to one address are throttled" */
    it("throttles the send and tells no admin", async () => {
      vi.useFakeTimers();

      const invites = new FakeOrganizationInviteRepository();
      invites.seedInvite(
        makeInvite({
          id: "invite-expired",
          inviteCode: "code-expired",
          expiration: new Date(Date.now() + 1000),
        }),
      );
      invites.seedOrganization(makeOrganization());
      invites.seedAdminEmails({ organizationId: "org-1", emails: ["admin@acme.com"] });

      // Past the invite's expiry, so the re-request route is even open.
      await vi.advanceTimersByTimeAsync(2000);

      const rateLimit = new FakeInviteRateLimit();
      const throttle = InviteSendThrottleService.create(rateLimit);
      // The allowance this invitation already spent, moments ago.
      for (let i = 0; i < 3; i++) {
        await throttle.assertInviteSendAllowed({ inviteId: "invite-expired" });
      }

      const mail = new FakeInviteMail();
      const service = InviteLifecycleService.create(makeInviteDeps({ invites, throttle, mail }));

      await expect(
        service.requestFreshInvite({
          inviteCode: "code-expired",
          membersSettingsUrl: "https://app.langwatch.ai/settings/members",
        }),
      ).rejects.toBeInstanceOf(InviteThrottledError);

      expect(mail.sentReRequests).toHaveLength(0);
    });
  });
});

describe("given two PAYMENT_PENDING invites bought on the same subscription", () => {
  describe("when the checkout for that subscription is approved", () => {
    /** @scenario "Approving payment-pending invitations turns each into a fresh pending invite and sends its mail" */
    it("turns each into a live PENDING invite with a fresh expiry and sends its mail", async () => {
      const invites = new FakeOrganizationInviteRepository();
      invites.seedOrganization(makeOrganization({ id: "org-1" }));
      invites.seedInvite(
        makeInvite({
          id: "invite-a",
          email: "a@acme.com",
          status: "PAYMENT_PENDING",
          subscriptionId: "sub-1",
          expiration: null,
        }),
      );
      invites.seedInvite(
        makeInvite({
          id: "invite-b",
          email: "b@acme.com",
          status: "PAYMENT_PENDING",
          subscriptionId: "sub-1",
          expiration: null,
        }),
      );

      const mail = new FakeInviteMail();
      const service = InviteLifecycleService.create(makeInviteDeps({ invites, mail }));

      const approved = await service.approvePaymentPendingInvites({
        subscriptionId: "sub-1",
        organizationId: "org-1",
      });

      expect(approved).toHaveLength(2);
      for (const invite of approved) {
        expect(invite.status).toBe("PENDING");
        expect(invite.expiration).not.toBeNull();
        expect(invite.expiration!.getTime()).toBeGreaterThan(Date.now());
      }
      expect(mail.sentInvites.map((sent) => sent.email).sort()).toEqual([
        "a@acme.com",
        "b@acme.com",
      ]);
    });
  });
});

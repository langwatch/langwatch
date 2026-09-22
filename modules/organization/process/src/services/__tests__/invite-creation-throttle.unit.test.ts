/**
 * `InviteCreationThrottleService` — the sender-scoped per-hour creation
 * counter the invitation door spends before a batch is written, one spend
 * per invited address, tier-resolved on the invited-to organization.
 * @vitest-environment node
 */
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { OrganizationCaller } from "@langwatch/organization-contract";
import { describe, expect, it, vi } from "vitest";

import type { OrganizationInvitations } from "../../app/organization.members.ts";
import {
  InviteCreationThrottleService,
  INVITE_CREATION_WINDOW_SECONDS,
} from "../invite-creation-throttle.service.ts";
import { OrganizationInvitationDoorService } from "../organization-invitation-door.service.ts";
import { FakeInviteRateLimit } from "./support/invite-fakes.ts";

// The registry's free/enterprise invitesCreatedPerHour, stated literally: a
// registry change fails this suite rather than silently re-deriving it.
const FREE_INVITES_PER_HOUR = 100;
const ENTERPRISE_INVITES_PER_HOUR = 400;

/** The plan the invited-to organization answers, for exactly the one bound this throttle reads. */
function entitlementOf(bound: number): Pick<EntitlementApi, "requestBound"> {
  return {
    requestBound: ({ key }) => {
      if (key !== "invitesCreatedPerHour") throw new Error(`unexpected bound: ${key}`);

      return Promise.resolve(bound);
    },
  };
}

function throttleOf(bound: number) {
  const rateLimit = new FakeInviteRateLimit();
  const throttle = InviteCreationThrottleService.create({
    rateLimit,
    plans: entitlementOf(bound),
  });

  return { throttle, rateLimit };
}

/** Every member unreachable by name except the `create` a refusal must never reach. */
function invitationStub(create: OrganizationInvitations["create"]): OrganizationInvitations {
  const unreachable =
    <TArgs extends readonly unknown[]>(name: string) =>
    (...args: TArgs): never => {
      throw new Error(`invitations.${name}(${args.length} args) is unreachable in this scenario`);
    };

  return {
    create,
    revoke: unreachable("revoke"),
    assertSendAllowed: unreachable("assertSendAllowed"),
    resend: unreachable("resend"),
    list: unreachable("list"),
    findByCode: unreachable("findByCode"),
    matchToAcceptor: unreachable("matchToAcceptor"),
    applyPending: unreachable("applyPending"),
    apply: unreachable("apply"),
    findLandingProjectSlug: unreachable("findLandingProjectSlug"),
    acceptUrl: unreachable("acceptUrl"),
    maskAddress: unreachable("maskAddress"),
    displayStatus: unreachable("displayStatus"),
    notifySeatLimitReached: unreachable("notifySeatLimitReached"),
    findUserIdByEmail: unreachable("findUserIdByEmail"),
  };
}

describe("InviteCreationThrottleService", () => {
  describe("given a free-tier organization and one sender", () => {
    it("passes 100 invites across batches, then refuses the 101st", async () => {
      const { throttle } = throttleOf(FREE_INVITES_PER_HOUR);
      const spend = (count: number) =>
        throttle.assertCreationAllowed({
          organizationId: "org-1",
          senderUserId: "user-1",
          count,
        });

      await expect(spend(50)).resolves.toBeUndefined();
      await expect(spend(50)).resolves.toBeUndefined();

      const refusal = await spend(1).catch((error: unknown) => error);

      expect(refusal).toMatchObject({
        code: "invites_rate_limited",
        httpStatus: 429,
        retryable: true,
        fault: "customer",
      });
    });

    it("spends one per invited address: a 50-email batch consumes 50", async () => {
      const { throttle } = throttleOf(FREE_INVITES_PER_HOUR);

      await throttle.assertCreationAllowed({
        organizationId: "org-1",
        senderUserId: "user-1",
        count: 50,
      });

      await expect(
        throttle.assertCreationAllowed({
          organizationId: "org-1",
          senderUserId: "user-1",
          count: 50,
        }),
      ).resolves.toBeUndefined();
      await expect(
        throttle.assertCreationAllowed({
          organizationId: "org-1",
          senderUserId: "user-1",
          count: 1,
        }),
      ).rejects.toMatchObject({ code: "invites_rate_limited" });
    });

    it("refuses a single batch larger than the whole window", async () => {
      const { throttle } = throttleOf(FREE_INVITES_PER_HOUR);

      await expect(
        throttle.assertCreationAllowed({
          organizationId: "org-1",
          senderUserId: "user-1",
          count: FREE_INVITES_PER_HOUR + 1,
        }),
      ).rejects.toMatchObject({ code: "invites_rate_limited" });
    });

    it("leaves a different sender's window untouched", async () => {
      const { throttle } = throttleOf(FREE_INVITES_PER_HOUR);
      await throttle.assertCreationAllowed({
        organizationId: "org-1",
        senderUserId: "user-1",
        count: FREE_INVITES_PER_HOUR,
      });

      await expect(
        throttle.assertCreationAllowed({
          organizationId: "org-1",
          senderUserId: "user-2",
          count: FREE_INVITES_PER_HOUR,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("given an enterprise organization past the free ceiling", () => {
    it("lets the sender through: the ceiling is tier-resolved on the invited-to organization", async () => {
      const { throttle } = throttleOf(ENTERPRISE_INVITES_PER_HOUR);

      await expect(
        throttle.assertCreationAllowed({
          organizationId: "org-enterprise",
          senderUserId: "user-1",
          count: FREE_INVITES_PER_HOUR + 1,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("given a window refusal", () => {
    it("names the wait in seconds from the counter's reset", async () => {
      const { throttle } = throttleOf(FREE_INVITES_PER_HOUR);
      await throttle.assertCreationAllowed({
        organizationId: "org-1",
        senderUserId: "user-1",
        count: FREE_INVITES_PER_HOUR,
      });

      const refusal = await throttle
        .assertCreationAllowed({
          organizationId: "org-1",
          senderUserId: "user-1",
          count: 1,
        })
        .catch((error: unknown) => error);

      const retryAfterSeconds = (refusal as { meta?: { retryAfterSeconds?: number } }).meta
        ?.retryAfterSeconds;
      expect(retryAfterSeconds).toBeGreaterThan(0);
      expect(retryAfterSeconds).toBeLessThanOrEqual(INVITE_CREATION_WINDOW_SECONDS);
    });
  });
});

describe("OrganizationInvitationDoorService.create", () => {
  describe("given the sender's creation window is spent", () => {
    it("refuses before any invitation is written", async () => {
      const { throttle } = throttleOf(0);
      const create = vi.fn<OrganizationInvitations["create"]>(async () => {
        throw new Error("the write is unreachable in this scenario");
      });
      const invitations = invitationStub(create);
      const door = OrganizationInvitationDoorService.create({
        invitations,
        joinRequests: null,
        plans: { assertCustomRolesAllowed: async () => {} } as never,
        signals: {
          trackServerEvent: () => {},
          fireTeamMemberInvitedNurturing: () => {},
        } as never,
        creationThrottle: throttle,
        ensurePersonalWorkspace: async () => undefined,
      });

      const refusal = await door
        .create(
          {
            organizationId: "org-1",
            validation: "lenient",
            invites: [{ email: "new@acme.test", role: "MEMBER", teamIds: "team-1" }],
          } as never,
          { id: "user-1" } as OrganizationCaller,
        )
        .catch((error: unknown) => error);

      expect(refusal).toMatchObject({ code: "invites_rate_limited", httpStatus: 429 });
      expect(create).not.toHaveBeenCalled();
    });
  });
});

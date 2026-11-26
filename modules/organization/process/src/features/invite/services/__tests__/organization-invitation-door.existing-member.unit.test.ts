/**
 * @vitest-environment node
 * A seat bought for an invitation is refused before anything is charged when the address
 * already belongs to a member. Spec: modules/organization/specs/invitations.feature
 */
import {
  AlreadyOrganizationMemberError,
  type OrganizationCaller,
} from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { OrganizationSignals } from "../../../../services/organization-signals.service.ts";
import { OrganizationInvitationDoorService } from "../organization-invitation-door.service.ts";
import type { OrganizationInvitations } from "../organization-invitations.service.ts";

const CALLER: OrganizationCaller = { id: "user-ana", name: "Ana", email: "ana@acme.test" };
const MEMBER = "sam@acme.test";

function doorWithMember() {
  const createSeatCheckout = vi.fn(async () => ({ url: "https://pay.test", subscriptionId: "s1" }));
  const assertWithinCaller = vi.fn(async () => {});
  const createPaymentPending = vi.fn(async () => {});
  const door = OrganizationInvitationDoorService.create({
    billing: { createSeatCheckout },
    getOldestTeamId: async () => "team-1",
    invitations: createApiFixture<OrganizationInvitations>({
      assertNotAlreadyMembers: async ({ emails }) => {
        const member = emails.find((email) => email.toLowerCase() === MEMBER);
        if (member !== undefined) throw new AlreadyOrganizationMemberError(member);
      },
      createPaymentPending,
    }),
    directory: { findProvenAddresses: async () => [] },
    signals: createApiFixture<OrganizationSignals>({ trackServerEvent: vi.fn() }),
    lifecycle: { membersInvited: vi.fn(), inviteAccepted: vi.fn() },
    creationThrottle: { assertCreationAllowed: async () => {} },
    ceiling: { assertWithinCaller },
    ensurePersonalWorkspace: vi.fn(async () => undefined),
  });
  return { door, createSeatCheckout, assertWithinCaller, createPaymentPending };
}

describe("given an address that already belongs to a member", () => {
  describe("when an admin asks whether a seat can be bought to invite it", () => {
    /** @scenario "A seat bought for someone already on the team is refused before any charge" */
    it("refuses with already_organization_member and asks nothing further", async () => {
      const { door, assertWithinCaller } = doorWithMember();

      const refusal = await door
        .checkInvitesWithinCaller(
          {
            organizationId: "org-1",
            invites: [{ email: "Sam@acme.test", role: "MEMBER", teamIds: "" }],
          },
          CALLER,
        )
        .catch((error: unknown) => error);

      expect(refusal).toMatchObject({ code: "already_organization_member" });
      expect(assertWithinCaller).not.toHaveBeenCalled();
    });
  });

  describe("when an admin on Free opens the seat checkout to invite it", () => {
    /** @scenario "A seat bought for someone already on the team is refused before any charge" */
    it("opens no checkout and holds no invitation", async () => {
      const { door, createSeatCheckout, createPaymentPending } = doorWithMember();

      const refusal = await door
        .checkoutSeats(
          {
            organizationId: "org-1",
            baseUrl: "https://app.test",
            totalSeats: 3,
            invites: [{ email: MEMBER, role: "MEMBER" }],
          },
          CALLER,
        )
        .catch((error: unknown) => error);

      expect(refusal).toMatchObject({ code: "already_organization_member" });
      expect(createSeatCheckout).not.toHaveBeenCalled();
      expect(createPaymentPending).not.toHaveBeenCalled();
    });
  });
});

describe("given an address that is not a member yet", () => {
  describe("when an admin asks whether a seat can be bought to invite it", () => {
    /** @scenario "A seat bought for a new person is checked and then allowed" */
    it("passes the members check and asks the inviter's ceiling", async () => {
      const { door, assertWithinCaller } = doorWithMember();

      await door.checkInvitesWithinCaller(
        {
          organizationId: "org-1",
          invites: [{ email: "lee@acme.test", role: "MEMBER", teamIds: "" }],
        },
        CALLER,
      );

      expect(assertWithinCaller).toHaveBeenCalledTimes(1);
    });
  });
});

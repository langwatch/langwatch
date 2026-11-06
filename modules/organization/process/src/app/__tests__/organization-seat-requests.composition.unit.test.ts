/**
 * Seat requests as `OrganizationModule.create` composes them over the memory registry.
 * @see modules/organization/specs/seat-requests.feature
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { BillingApi } from "@langwatch/enterprise-billing-contract";
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import type { NotificationService } from "@langwatch/notification-contract";
import { OrganizationUserRole, type OrganizationCaller } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nowInstant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { MemoryAccessNoticeMailChannel } from "../../channels/memory/memory.access-notice-mail.channel.ts";
import { MemoryOrganizationDatabase } from "../../repositories/memory/memory.organization.database.ts";
import type { OrganizationLifecycleSenders } from "../../services/organization-lifecycle-notice.service.ts";
import { OrganizationModule } from "../organization.app.ts";
import { organizationModuleSetup } from "./support/organization-module-setup.ts";

const ORGANIZATION_ID = "org-acme";
const ADA: OrganizationCaller = { id: "user-ada", name: "Ada Admin", email: "ada@acme.example" };
const BILL = { id: "user-bill", name: "Bill Payer", email: "bill@acme.example" };

/** Ada (admin) and Bill (member) take two full seats; `freeFull` and `freeLite` add room. */
function planWith({
  freeFull = 0,
  freeLite = 0,
  plan = {},
}: {
  freeFull?: number;
  freeLite?: number;
  plan?: Partial<Plan>;
}): Plan {
  return {
    planSource: "free",
    type: "free",
    name: "Free",
    free: true,
    maxMembers: 2 + freeFull,
    maxMembersLite: freeLite,
    maxMessagesPerMonth: 1_000_000,
    canPublish: true,
    prices: { USD: 0, EUR: 0 },
    ...plan,
  };
}

type SalesNotice = Parameters<BillingApi["notifySalesOfSeatRequest"]>[0];

async function application(
  options: { freeFull?: number; freeLite?: number; plan?: Partial<Plan>; isSaas?: boolean } = {},
) {
  const memory = MemoryOrganizationDatabase.create();
  const state = { plan: planWith(options) };
  const salesNotices: SalesNotice[] = [];
  const setup = organizationModuleSetup({
    memory,
    permissions: createApiFixture<AuthzApi>(
      {
        findPermissionsBeyondCaller: async () => [],
        listBillingMembers: async () => [{ userId: BILL.id }],
        invalidateOrganization: async () => {},
      },
      "AuthzApi",
    ),
    entitlement: createApiFixture<EntitlementApi>(
      { getActivePlan: async () => state.plan, requestBound: async () => 1_000 },
      "EntitlementApi",
    ),
    notifications: createApiFixture<NotificationService>({}, "NotificationService"),
    billing: createApiFixture<BillingApi>(
      {
        notifySalesOfSeatRequest: async (input: SalesNotice) => {
          salesNotices.push(input);
        },
      },
      "BillingApi",
    ),
  });
  for (const person of [ADA, BILL]) {
    memory.users.set(person.id, {
      id: person.id,
      name: person.name ?? null,
      email: person.email ?? null,
      deactivatedAt: null,
    });
  }
  await setup.repositories.membership(setup.dependencies.permissions).createAndAssign({
    userId: ADA.id,
    orgId: ORGANIZATION_ID,
    orgName: "ACME",
    orgSlug: "acme",
    teamId: "team-acme",
    teamSlug: "engineering",
    pricingModel: "SEAT_EVENT",
  });
  memory.organizationUsers.push({
    userId: BILL.id,
    organizationId: ORGANIZATION_ID,
    role: OrganizationUserRole.MEMBER,
    disabledAt: null,
    createdAt: nowInstant(),
    updatedAt: nowInstant(),
  });
  const app = await OrganizationModule.create({
    ...setup,
    config: { ...setup.config, isSaas: options.isSaas ?? false },
  });
  app.connectLifecycle(
    createApiFixture<OrganizationLifecycleSenders>({
      recordMemberEnabled: { send: async () => {} },
    }),
  );
  const mail = setup.channels.accessNoticeMail as MemoryAccessNoticeMailChannel;

  /** A person signing in by single sign-on, asking for `seat`. */
  async function arrive({
    email,
    seat = "MEMBER",
  }: {
    email: string;
    seat?: "MEMBER" | "DEVELOPER";
  }) {
    const userId = `user-${email.split("@")[0]}`;
    memory.users.set(userId, { id: userId, name: null, email, deactivatedAt: null });
    const admission = await app.createMembership({ organizationId: ORGANIZATION_ID, userId, seat });
    return { userId, admission };
  }

  const membershipOf = (userId: string) =>
    memory.organizationUsers.find(
      (row) => row.userId === userId && row.organizationId === ORGANIZATION_ID,
    );
  const openRequests = async () =>
    (await app.listOpenSeatRequests({ organizationId: ORGANIZATION_ID })).requests;

  return { app, memory, state, mail, salesNotices, arrive, membershipOf, openRequests };
}

describe("given an organization over its seat limit", () => {
  describe("when an arrival asking for a full seat finds no full and no Lite seat", () => {
    /** @scenario "An arrival held pending opens a seat request" */
    it("holds them pending with no access and opens a request naming them", async () => {
      const { arrive, membershipOf, openRequests } = await application();

      const { userId, admission } = await arrive({ email: "late@acme.example" });

      expect(admission).toMatchObject({ seat: "EXTERNAL", pending: true });
      expect(membershipOf(userId)?.disabledAt).not.toBeNull();
      expect((await openRequests()).map((request) => request.email)).toEqual(["late@acme.example"]);
    });
  });

  describe("when an arrival asking for a full seat is admitted as a Lite Member", () => {
    /** @scenario "An arrival admitted as a Lite Member for want of a full seat opens a seat request" */
    it("keeps their Lite access and opens a request naming them", async () => {
      const { arrive, membershipOf, openRequests } = await application({ freeLite: 1 });

      const { userId, admission } = await arrive({ email: "lite@acme.example" });

      expect(admission).toMatchObject({ seat: "EXTERNAL", pending: false });
      expect(membershipOf(userId)?.disabledAt).toBeNull();
      const [request] = await openRequests();
      expect(request).toMatchObject({ email: "lite@acme.example", source: "lite" });
    });
  });

  describe("when an arrival gets the full seat it asked for", () => {
    /** @scenario "An arrival given the full seat it asked for opens no request" */
    it("opens no request", async () => {
      const { arrive, openRequests } = await application({ freeFull: 1 });

      await arrive({ email: "fits@acme.example" });

      expect(await openRequests()).toEqual([]);
    });
  });

  describe("when an arrival asks for a Developer seat", () => {
    /** @scenario "A Developer arrival never opens a seat request" */
    it("opens no request", async () => {
      const { arrive, openRequests } = await application();

      await arrive({ email: "dev@acme.example", seat: "DEVELOPER" });

      expect(await openRequests()).toEqual([]);
    });
  });

  describe("when the same person arrives again", () => {
    /** @scenario "A second arrival of the same person does not open a second request" */
    it("keeps exactly one request naming them", async () => {
      const { arrive, openRequests } = await application();

      await arrive({ email: "late@acme.example" });
      await arrive({ email: "late@acme.example" });

      expect((await openRequests()).filter((r) => r.email === "late@acme.example")).toHaveLength(1);
    });
  });

  describe("when the identity provider refuses an address that would be held pending", () => {
    /** @scenario "A refused sign-in that would be held pending opens a seat request flagged as refused" */
    it("answers seat_limit and opens a request flagged as refused by that provider", async () => {
      const { app, openRequests } = await application();

      const answer = await app.recordRefusedSignIn({
        organizationId: ORGANIZATION_ID,
        email: "Late@Acme.example",
        idp: "okta",
      });

      expect(answer).toEqual({ outcome: "seat_limit" });
      const [request] = await openRequests();
      expect(request).toMatchObject({
        email: "late@acme.example",
        idpRefused: true,
        idpKind: "okta",
        source: "idp_refused",
      });
    });
  });

  describe("when the identity provider refuses an address while a seat is free", () => {
    /** @scenario "A refused sign-in with a seat free records an identity provider notice" */
    it("answers refused, opens no request and mails a refusal notice", async () => {
      const { app, mail, openRequests } = await application({ freeFull: 1 });

      const answer = await app.recordRefusedSignIn({
        organizationId: ORGANIZATION_ID,
        email: "nobody@acme.example",
        idp: "okta",
      });

      expect(answer).toEqual({ outcome: "refused" });
      expect(await openRequests()).toEqual([]);
      expect(mail.idpRefusals.map((sent) => sent.personEmail)).toContain("nobody@acme.example");
    });
  });
});

describe("given an open seat request", () => {
  describe("when an administrator approves a held person while a full seat is free", () => {
    /** @scenario "Approving a held person on a free seat enables them as a full member" */
    it("enables them as a full member and closes the request", async () => {
      const { app, state, arrive, membershipOf, openRequests } = await application();
      const { userId } = await arrive({ email: "late@acme.example" });
      const [request] = await openRequests();
      state.plan = planWith({ freeFull: 1 });

      const resolved = await app.approveSeatRequest(
        { organizationId: ORGANIZATION_ID, seatRequestId: request!.id },
        ADA,
      );

      expect(resolved).toEqual({ outcome: "enabled" });
      expect(membershipOf(userId)).toMatchObject({
        role: OrganizationUserRole.MEMBER,
        disabledAt: null,
      });
      expect(await openRequests()).toEqual([]);
    });
  });

  describe("when an administrator approves a Lite Member", () => {
    /** @scenario "Approving a Lite Member changes their seat to a full member" */
    it("makes them a full member with access", async () => {
      const { app, state, arrive, membershipOf, openRequests } = await application({ freeLite: 1 });
      const { userId } = await arrive({ email: "lite@acme.example" });
      const [request] = await openRequests();
      state.plan = planWith({ freeFull: 1, freeLite: 1 });

      const resolved = await app.approveSeatRequest(
        { organizationId: ORGANIZATION_ID, seatRequestId: request!.id },
        ADA,
      );

      expect(resolved).toEqual({ outcome: "promoted" });
      expect(membershipOf(userId)).toMatchObject({
        role: OrganizationUserRole.MEMBER,
        disabledAt: null,
      });
    });
  });

  describe("when an administrator approves a refused sign-in with no membership", () => {
    /** @scenario "Approving a refused sign-in with no membership invites the address as a full member" */
    it("creates a full member invitation for the address", async () => {
      const { app, state, openRequests } = await application();
      await app.recordRefusedSignIn({
        organizationId: ORGANIZATION_ID,
        email: "late@acme.example",
        idp: "okta",
      });
      const [request] = await openRequests();
      state.plan = planWith({ freeFull: 1 });

      const resolved = await app.approveSeatRequest(
        { organizationId: ORGANIZATION_ID, seatRequestId: request!.id },
        ADA,
      );

      expect(resolved).toEqual({ outcome: "invited" });
      const invites = await app.listPendingInvitations({ organizationId: ORGANIZATION_ID });
      expect(invites.map((invite) => [invite.email, invite.role])).toEqual([
        ["late@acme.example", "MEMBER"],
      ]);
    });
  });

  describe("when an administrator approves while every full seat is in use", () => {
    /** @scenario "Approving with no full member seat free is refused with the seat-limit code" */
    it("refuses with member_seat_limit_reached and leaves the request open", async () => {
      const { app, arrive, openRequests } = await application();
      await arrive({ email: "late@acme.example" });
      const [request] = await openRequests();

      await expect(
        app.approveSeatRequest(
          { organizationId: ORGANIZATION_ID, seatRequestId: request!.id },
          ADA,
        ),
      ).rejects.toMatchObject({ code: "member_seat_limit_reached" });
      expect((await openRequests()).map((open) => open.id)).toEqual([request!.id]);
    });
  });

  describe("when an administrator approves a request that is not open", () => {
    /** @scenario "Approving a seat request that is not open is refused" */
    it("refuses with seat_request_not_found", async () => {
      const { app } = await application();

      await expect(
        app.approveSeatRequest({ organizationId: ORGANIZATION_ID, seatRequestId: "nope" }, ADA),
      ).rejects.toMatchObject({ code: "seat_request_not_found" });
    });
  });

  describe("when an administrator declines it", () => {
    /** @scenario "Declining closes the request and leaves the membership as it is" */
    it("closes the request and the person stays held with no access", async () => {
      const { app, arrive, membershipOf, openRequests } = await application();
      const { userId } = await arrive({ email: "late@acme.example" });
      const [request] = await openRequests();

      const resolved = await app.declineSeatRequest(
        { organizationId: ORGANIZATION_ID, seatRequestId: request!.id },
        ADA,
      );

      expect(resolved).toEqual({ outcome: "declined" });
      expect(await openRequests()).toEqual([]);
      expect(membershipOf(userId)).toMatchObject({ role: OrganizationUserRole.EXTERNAL });
      expect(membershipOf(userId)?.disabledAt).not.toBeNull();
    });
  });
});

describe("given how the organization pays", () => {
  describe("when a full seat is already free", () => {
    /** @scenario "An organization with a full seat already free approves directly" */
    it("says a seat is free", async () => {
      const { app } = await application({ freeFull: 1 });

      const listed = await app.listOpenSeatRequests({ organizationId: ORGANIZATION_ID });

      expect(listed.seatFree).toBe(true);
    });
  });

  describe("when an account-managed cloud organization opens a request twice", () => {
    /** @scenario "Sales hear about a seat request from an account-managed organization once" */
    it("tells sales once", async () => {
      const { arrive, salesNotices } = await application({
        isSaas: true,
        plan: { planSource: "license", type: "ENTERPRISE", free: false },
      });

      await arrive({ email: "late@acme.example" });
      await arrive({ email: "late@acme.example" });

      expect(salesNotices).toEqual([
        {
          organizationId: ORGANIZATION_ID,
          organizationName: "ACME",
          plan: "ENTERPRISE",
          seats: 2,
          requestedSeats: 3,
        },
      ]);
    });
  });
});

describe("given administrators and Billing members to tell", () => {
  describe("when the first seat request of the window opens", () => {
    /** @scenario "The first notice of the day is mailed at once to administrators and Billing members" */
    it("mails Ada and Bill about the person at once", async () => {
      const { arrive, mail } = await application();

      await arrive({ email: "late@acme.example" });

      expect(mail.seatRequests.map((sent) => [sent.recipientEmail, sent.personEmail])).toEqual([
        ["ada@acme.example", "late@acme.example"],
        ["bill@acme.example", "late@acme.example"],
      ]);
    });
  });
});

describe("given a person whose membership gives no access", () => {
  describe("when a held person reads their held memberships", () => {
    /** @scenario "A held person reads the administrators and Billing members to contact" */
    it("answers the organization as over its seat limit, Ada then Bill to contact", async () => {
      const { app, arrive } = await application();
      const { userId } = await arrive({ email: "late@acme.example" });

      const answer = await app.getHeldMemberships({ id: userId });

      expect(answer).toEqual({
        hasActiveMembership: false,
        held: [
          {
            organizationId: ORGANIZATION_ID,
            organizationName: "ACME",
            reason: "seat_limit",
            contacts: [
              { name: "Ada Admin", email: "ada@acme.example" },
              { name: "Bill Payer", email: "bill@acme.example" },
            ],
          },
        ],
      });
    });
  });

  describe("when a person whose request was declined reads them", () => {
    /** @scenario "A person whose request was declined is told an administrator turned off their access" */
    it("answers access turned off", async () => {
      const { app, arrive, openRequests } = await application();
      const { userId } = await arrive({ email: "late@acme.example" });
      const [request] = await openRequests();
      await app.declineSeatRequest(
        { organizationId: ORGANIZATION_ID, seatRequestId: request!.id },
        ADA,
      );

      const answer = await app.getHeldMemberships({ id: userId });

      expect(answer.held.map((held) => held.reason)).toEqual(["access_turned_off"]);
    });
  });
});

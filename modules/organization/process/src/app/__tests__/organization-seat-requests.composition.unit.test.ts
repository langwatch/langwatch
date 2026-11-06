/**
 * Seat requests as `OrganizationModule.create` composes them: admission and resolution.
 * @see modules/organization/specs/seat-requests.feature
 */
import { OrganizationUserRole } from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";

import {
  ADA,
  application,
  ORGANIZATION_ID,
  planWith,
} from "./support/seat-requests-application.ts";

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

  describe("when the identity provider refuses a full-seat joiner while only Lite seats are free", () => {
    /** @scenario "A refused sign-in that would be held pending opens a seat request flagged as refused" */
    it("answers seat_limit, as the joiner would be left Lite for want of a full seat", async () => {
      const { app, openRequests } = await application({ freeLite: 3 });

      const answer = await app.recordRefusedSignIn({
        organizationId: ORGANIZATION_ID,
        email: "late@acme.example",
        idp: "saml",
      });

      expect(answer).toEqual({ outcome: "seat_limit" });
      expect(await openRequests()).toHaveLength(1);
    });
  });

  describe("when the identity provider refuses a Developer-seat joiner at the full seat limit", () => {
    /** @scenario "A refused sign-in with a seat free records an identity provider notice" */
    it("answers refused, since a Developer is its own seat", async () => {
      const { app, openRequests } = await application({ joinerRole: "DEVELOPER" });

      const answer = await app.recordRefusedSignIn({
        organizationId: ORGANIZATION_ID,
        email: "dev@acme.example",
        idp: "okta",
      });

      expect(answer).toEqual({ outcome: "refused" });
      expect(await openRequests()).toEqual([]);
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

  describe("when one administrator approves while another declines", () => {
    /** @scenario "An approval and a decline of the same request never both act" */
    it("lets exactly one of them act and refuses the other", async () => {
      const { app, state, arrive, membershipOf, openRequests } = await application();
      const { userId } = await arrive({ email: "late@acme.example" });
      const [request] = await openRequests();
      state.plan = planWith({ freeFull: 1 });
      const input = { organizationId: ORGANIZATION_ID, seatRequestId: request!.id };

      const settled = await Promise.allSettled([
        app.declineSeatRequest(input, ADA),
        app.approveSeatRequest(input, ADA),
      ]);

      expect(settled.map((one) => one.status)).toEqual(["fulfilled", "rejected"]);
      expect((settled[1] as PromiseRejectedResult).reason).toMatchObject({
        code: "seat_request_not_found",
      });
      expect(membershipOf(userId)?.disabledAt).not.toBeNull();
      expect(await openRequests()).toEqual([]);
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

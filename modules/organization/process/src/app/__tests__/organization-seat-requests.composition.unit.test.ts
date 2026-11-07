/**
 * Seat requests as `OrganizationModule.create` composes them: admission and resolution.
 * @see modules/organization/specs/seat-requests.feature
 */
import { OrganizationUserRole } from "@langwatch/organization-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { MemorySeatRequestRepository } from "../../repositories/memory/memory.seat-request.repository.ts";
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

  describe("when a held person's seat request failed to open and they arrive again", () => {
    /** @scenario "A held person whose seat request failed to open gets one when they arrive again" */
    it("opens the missing request", async () => {
      const { arrive, openRequests, seatRequests } = await application();
      const open = seatRequests.open.bind(seatRequests);
      seatRequests.open = async () => {
        throw new Error("seat request store unavailable");
      };
      await arrive({ email: "late@acme.example" });
      expect(await openRequests()).toEqual([]);
      seatRequests.open = open;

      await arrive({ email: "late@acme.example" });

      expect((await openRequests()).map((request) => request.email)).toEqual(["late@acme.example"]);
    });
  });

  describe("when a Lite member with no seat request signs in again", () => {
    /** @scenario "A member an admin moved to Lite is not turned into a seat request" */
    it("opens no request", async () => {
      const { arrive, openRequests, seatRequests } = await application({ freeLite: 1 });
      const open = seatRequests.open.bind(seatRequests);
      seatRequests.open = async () => {
        throw new Error("no request on file");
      };
      await arrive({ email: "lite@acme.example" });
      seatRequests.open = open;

      await arrive({ email: "lite@acme.example" });

      expect(await openRequests()).toEqual([]);
    });
  });

  describe("when a held person whose seat request was declined arrives again", () => {
    /** @scenario "Arriving again never reopens a seat request that was answered" */
    it("leaves the declined request closed", async () => {
      const { app, arrive, openRequests } = await application();
      await arrive({ email: "late@acme.example" });
      const [request] = await openRequests();
      await app.declineSeatRequest(
        { organizationId: ORGANIZATION_ID, seatRequestId: request!.id },
        ADA,
      );

      await arrive({ email: "late@acme.example" });

      expect(await openRequests()).toEqual([]);
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

  describe("when an approval refused for want of a seat cannot hand its claim back at once", () => {
    let given: Awaited<ReturnType<typeof application>>;
    let requestId: string;

    beforeEach(async () => {
      given = await application();
      await given.arrive({ email: "late@acme.example" });
      const [request] = await given.openRequests();
      requestId = request!.id;
    });

    /** @scenario "An approval that cannot hand its claim back retries, then fails as an infrastructure error" */
    it("retries the hand-back and refuses with member_seat_limit_reached", async () => {
      const { app, openRequests, seatRequests } = given;
      const release = seatRequests.release.bind(seatRequests);
      let failures = 1;
      seatRequests.release = async (claim) => {
        if (failures-- > 0) throw new Error("seat request store unavailable");
        return release(claim);
      };

      await expect(
        app.approveSeatRequest({ organizationId: ORGANIZATION_ID, seatRequestId: requestId }, ADA),
      ).rejects.toMatchObject({ code: "member_seat_limit_reached" });
      expect((await openRequests()).map((open) => open.id)).toEqual([requestId]);
    });

    /** @scenario "An approval that cannot hand its claim back retries, then fails as an infrastructure error" */
    it("fails with an unhandled error naming both failures when the hand-back keeps failing", async () => {
      const { app, seatRequests } = given;
      const releaseFailure = new Error("seat request store unavailable");
      seatRequests.release = async () => {
        throw releaseFailure;
      };

      const failure = await app
        .approveSeatRequest({ organizationId: ORGANIZATION_ID, seatRequestId: requestId }, ADA)
        .catch((error: unknown) => error);

      expect(failure).toMatchObject({
        name: "SeatRequestReleaseError",
        cause: releaseFailure,
        releaseFailure,
        refusal: expect.objectContaining({ code: "member_seat_limit_reached" }),
      });
      expect(failure).not.toHaveProperty("code");
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

describe("given an approved seat request whose seat never landed", () => {
  const HOUR_MS = 60 * 60 * 1000;

  /** An approval claimed `ageMs` ago whose process stopped before the seat was given. */
  async function strandedApproval(ageMs: number) {
    const given = await application();
    const { userId } = await given.arrive({ email: "late@acme.example" });
    const [request] = await given.openRequests();
    await given.seatRequests.resolve({
      organizationId: ORGANIZATION_ID,
      id: request!.id,
      status: "APPROVED",
      resolvedByUserId: ADA.id,
      at: Date.now() - ageMs,
    });
    return { ...given, userId, requestId: request!.id };
  }

  describe("when an administrator lists open seat requests long after the approval", () => {
    /** @scenario "An approval whose seat never landed is reopened" */
    it("reopens the request, so it is on the list again", async () => {
      const { openRequests, membershipOf, userId, requestId } = await strandedApproval(HOUR_MS);

      expect((await openRequests()).map((open) => open.id)).toEqual([requestId]);
      expect(membershipOf(userId)).toMatchObject({ disabledAt: expect.anything() });
    });
  });

  describe("when the approval is still within its grace period", () => {
    /** @scenario "An approval still giving its seat is left alone" */
    it("leaves the request approved", async () => {
      const { openRequests } = await strandedApproval(60 * 1000);

      expect(await openRequests()).toEqual([]);
    });
  });

  describe("when the seat was given but could not be marked as given", () => {
    /** @scenario "An approval whose seat landed but was never marked is settled, not reopened" */
    it("keeps the request approved and marks the seat given", async () => {
      const { app, state, arrive, openRequests, seatRequests, membershipOf } = await application();
      const { userId } = await arrive({ email: "late@acme.example" });
      const [request] = await openRequests();
      state.plan = planWith({ freeFull: 1 });
      seatRequests.settleSeat = async () => {
        throw new Error("seat request store unavailable");
      };

      const resolved = await app.approveSeatRequest(
        { organizationId: ORGANIZATION_ID, seatRequestId: request!.id },
        ADA,
      );
      seatRequests.seatPendingSince.set(request!.id, Date.now() - HOUR_MS);
      seatRequests.settleSeat = MemorySeatRequestRepository.prototype.settleSeat.bind(seatRequests);

      expect(resolved).toEqual({ outcome: "enabled" });
      expect(await openRequests()).toEqual([]);
      expect(seatRequests.seatPendingSince.has(request!.id)).toBe(false);
      expect(membershipOf(userId)).toMatchObject({ disabledAt: null });
    });
  });

  describe("when an approval invited the address but could not mark the seat as given", () => {
    /** @scenario "An approval whose invitation went out but was never marked is settled, not reopened" */
    it("keeps the request approved, since the invitation is its seat", async () => {
      const { app, state, openRequests, seatRequests } = await application();
      await app.recordRefusedSignIn({
        organizationId: ORGANIZATION_ID,
        email: "late@acme.example",
        idp: "okta",
      });
      const [request] = await openRequests();
      state.plan = planWith({ freeFull: 1 });
      seatRequests.settleSeat = async () => {
        throw new Error("seat request store unavailable");
      };

      const resolved = await app.approveSeatRequest(
        { organizationId: ORGANIZATION_ID, seatRequestId: request!.id },
        ADA,
      );
      seatRequests.seatPendingSince.set(request!.id, Date.now() - HOUR_MS);
      seatRequests.settleSeat = MemorySeatRequestRepository.prototype.settleSeat.bind(seatRequests);

      expect(resolved).toEqual({ outcome: "invited" });
      expect(await openRequests()).toEqual([]);
      expect(seatRequests.seatPendingSince.has(request!.id)).toBe(false);
    });
  });
});

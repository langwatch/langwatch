/**
 * An approval buys the seat a Lite Member's request needs in one click, at once or through the
 * Stripe page, and a request declined and asked again meanwhile is never approved by it.
 * @see modules/organization/specs/seat-requests.feature
 */
import { HandledError } from "@langwatch/handled-error";
import { OrganizationUserRole } from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";

import {
  ADA,
  application,
  ORGANIZATION_ID,
  STRIPE_SEAT_PLAN,
} from "./support/seat-requests-application.ts";

const codeOf = (error: unknown) => (HandledError.isHandled(error) ? error.code : undefined);
const scope = { organizationId: ORGANIZATION_ID };

describe("given an organization paying per seat in Stripe with every full seat in use", () => {
  const stripe = { isSaas: true, plan: STRIPE_SEAT_PLAN };

  async function lenaAsking(
    options: { plan?: typeof STRIPE_SEAT_PLAN; isSaas?: boolean } = stripe,
  ) {
    const context = await application(options);
    const lena = context.liteMember({ email: "lena@acme.example" });
    await context.app.requestSeatAccess(scope, lena.caller);
    const [request] = await context.openRequests();
    return { ...context, lena, seatRequestId: request!.id };
  }

  describe("when an administrator approves with a seat and Stripe charges at once", () => {
    /** @scenario "Approve with no seat free on a live Stripe seat subscription adds the seat and approves" */
    it("adds one seat and makes her a full member", async () => {
      const { app, lena, seatRequestId, membershipOf, seatBilling } = await lenaAsking();

      const answer = await app.approveSeatRequestWithSeat({ ...scope, seatRequestId }, ADA);

      expect(answer).toEqual({ status: "approved", outcome: "promoted", seatAdded: true });
      expect(seatBilling.purchases).toBe(1);
      expect(membershipOf(lena.userId)?.role).toBe(OrganizationUserRole.MEMBER);
    });
  });

  describe("when two administrators approve with a seat at once", () => {
    /** @scenario "Approve with no seat free on a live Stripe seat subscription adds the seat and approves" */
    it("buys one seat and approves once", async () => {
      const { app, lena, seatRequestId, membershipOf, seatBilling } = await lenaAsking();

      let second: unknown;
      seatBilling.duringPurchase = async () => {
        second = await app
          .approveSeatRequestWithSeat({ ...scope, seatRequestId }, ADA)
          .catch((error: unknown) => error);
      };

      const first = await app.approveSeatRequestWithSeat({ ...scope, seatRequestId }, ADA);

      expect(first).toEqual({ status: "approved", outcome: "promoted", seatAdded: true });
      expect(codeOf(second)).toBe("seat_request_not_found");
      expect(seatBilling.purchases).toBe(1);
      expect(membershipOf(lena.userId)?.role).toBe(OrganizationUserRole.MEMBER);
    });
  });

  describe("when the seat charge needs the customer", () => {
    /** @scenario "When Stripe needs the customer, Approve answers the Stripe page and approves nothing yet" */
    it("answers the Stripe page and leaves the request open", async () => {
      const { app, seatRequestId, seatBilling, openRequests } = await lenaAsking();
      seatBilling.purchase = "payment_required";

      const answer = await app.approveSeatRequestWithSeat({ ...scope, seatRequestId }, ADA);

      expect(answer).toMatchObject({
        status: "payment_required",
        url: "https://invoice.stripe.example/in_seat",
      });
      expect((await openRequests()).map((open) => open.id)).toEqual([seatRequestId]);
    });

    /** @scenario "Once the Stripe page is paid, completing the approval approves the request" */
    it("approves once the Stripe page is paid", async () => {
      const { app, lena, seatRequestId, seatBilling, membershipOf, openRequests } =
        await lenaAsking();
      seatBilling.purchase = "payment_required";
      const waiting = await app.approveSeatRequestWithSeat({ ...scope, seatRequestId }, ADA);
      if (waiting.status !== "payment_required") throw new Error("expected a Stripe page");

      const done = await app.completeSeatApproval(
        { ...scope, seatRequestId, paymentRef: waiting.paymentRef },
        ADA,
      );

      expect(done).toEqual({ status: "approved", outcome: "promoted" });
      expect(membershipOf(lena.userId)?.role).toBe(OrganizationUserRole.MEMBER);
      expect(await openRequests()).toEqual([]);
    });

    /** @scenario "A Stripe page still open leaves the request open" */
    it("answers waiting while the page is still open", async () => {
      const { app, seatRequestId, seatBilling, openRequests } = await lenaAsking();
      seatBilling.purchase = "payment_required";
      seatBilling.payment = "open";
      const waiting = await app.approveSeatRequestWithSeat({ ...scope, seatRequestId }, ADA);
      if (waiting.status !== "payment_required") throw new Error("expected a Stripe page");

      const done = await app.completeSeatApproval(
        { ...scope, seatRequestId, paymentRef: waiting.paymentRef },
        ADA,
      );

      expect(done).toEqual({ status: "waiting" });
      expect(await openRequests()).toHaveLength(1);
    });

    /** @scenario "A Stripe page that ended unpaid approves nothing" */
    it("answers failed when the page ended unpaid", async () => {
      const { app, seatRequestId, seatBilling, openRequests } = await lenaAsking();
      seatBilling.purchase = "payment_required";
      seatBilling.payment = "failed";
      const waiting = await app.approveSeatRequestWithSeat({ ...scope, seatRequestId }, ADA);
      if (waiting.status !== "payment_required") throw new Error("expected a Stripe page");

      const done = await app.completeSeatApproval(
        { ...scope, seatRequestId, paymentRef: waiting.paymentRef },
        ADA,
      );

      expect(done).toEqual({ status: "failed" });
      expect(await openRequests()).toHaveLength(1);
    });
  });

  describe("when the request was declined and asked again before an older Stripe page was paid", () => {
    /** @scenario "A Stripe page from before a decline never approves the request opened again" */
    it("refuses with seat_request_not_found and leaves the new request open", async () => {
      const { app, lena, seatRequestId, seatBilling, openRequests } = await lenaAsking();
      seatBilling.purchase = "payment_required";
      const waiting = await app.approveSeatRequestWithSeat({ ...scope, seatRequestId }, ADA);
      if (waiting.status !== "payment_required") throw new Error("expected a Stripe page");
      await app.declineSeatRequest({ ...scope, seatRequestId }, ADA);
      await new Promise((resolve) => setTimeout(resolve, 2));
      await app.requestSeatAccess(scope, lena.caller);

      const refusal = await app
        .completeSeatApproval({ ...scope, seatRequestId, paymentRef: waiting.paymentRef }, ADA)
        .catch((error: unknown) => error);

      expect(codeOf(refusal)).toBe("seat_request_not_found");
      expect((await openRequests()).map((open) => open.id)).toEqual([seatRequestId]);
    });
  });

  describe("when the request is declined and asked again while the Stripe page is being settled", () => {
    /** @scenario "A Stripe page from before a decline never approves the request opened again" */
    it("refuses with seat_request_not_found and leaves the new request open", async () => {
      const { app, lena, seatRequestId, seatBilling, openRequests } = await lenaAsking();
      seatBilling.purchase = "payment_required";
      const waiting = await app.approveSeatRequestWithSeat({ ...scope, seatRequestId }, ADA);
      if (waiting.status !== "payment_required") throw new Error("expected a Stripe page");
      seatBilling.duringSettle = async () => {
        await app.declineSeatRequest({ ...scope, seatRequestId }, ADA);
        await new Promise((resolve) => setTimeout(resolve, 2));
        await app.requestSeatAccess(scope, lena.caller);
      };

      const refusal = await app
        .completeSeatApproval({ ...scope, seatRequestId, paymentRef: waiting.paymentRef }, ADA)
        .catch((error: unknown) => error);

      expect(codeOf(refusal)).toBe("seat_request_not_found");
      expect((await openRequests()).map((open) => open.id)).toEqual([seatRequestId]);
    });
  });

  describe("when she asks again while an approval is still buying her seat", () => {
    /** @scenario "Asking again while an approval is giving its seat reopens nothing" */
    it("keeps the approval and buys one seat", async () => {
      const { app, lena, seatRequestId, seatBilling, openRequests, membershipOf } =
        await lenaAsking();
      seatBilling.duringPurchase = async () => {
        await app.requestSeatAccess(scope, lena.caller);
      };

      const answer = await app.approveSeatRequestWithSeat({ ...scope, seatRequestId }, ADA);

      expect(answer).toEqual({ status: "approved", outcome: "promoted", seatAdded: true });
      expect(await openRequests()).toEqual([]);
      expect(seatBilling.purchases).toBe(1);
      expect(membershipOf(lena.userId)?.role).toBe(OrganizationUserRole.MEMBER);
    });
  });

  describe("when the request is declined and asked again just as an approval with a seat starts", () => {
    /** @scenario "A request declined and asked again as an approval starts approves nothing" */
    it("refuses with seat_request_not_found, buys nothing and leaves the new request open", async () => {
      const { app, lena, seatRequestId, seatBilling, seatRequests, openRequests } =
        await lenaAsking();
      const getOpen = seatRequests.getOpen.bind(seatRequests);
      let replaced = false;
      seatRequests.getOpen = async (input) => {
        const row = await getOpen(input);
        if (!replaced) {
          replaced = true;
          await app.declineSeatRequest({ ...scope, seatRequestId }, ADA);
          await new Promise((resolve) => setTimeout(resolve, 2));
          await app.requestSeatAccess(scope, lena.caller);
        }
        return row;
      };

      const refusal = await app
        .approveSeatRequestWithSeat({ ...scope, seatRequestId }, ADA)
        .catch((error: unknown) => error);

      expect(codeOf(refusal)).toBe("seat_request_not_found");
      expect(seatBilling.purchases).toBe(0);
      expect((await openRequests()).map((open) => open.id)).toEqual([seatRequestId]);
    });
  });

  describe("when the request is declined and asked again just as a plain approval starts", () => {
    /** @scenario "A request declined and asked again as an approval starts approves nothing" */
    it("refuses with seat_request_not_found and leaves the new request open", async () => {
      const context = await application({ freeFull: 1 });
      const lena = context.liteMember({ email: "lena@acme.example" });
      await context.app.requestSeatAccess(scope, lena.caller);
      const [request] = await context.openRequests();
      const seatRequestId = request!.id;
      const getOpen = context.seatRequests.getOpen.bind(context.seatRequests);
      let replaced = false;
      context.seatRequests.getOpen = async (input) => {
        const row = await getOpen(input);
        if (!replaced) {
          replaced = true;
          await context.app.declineSeatRequest({ ...scope, seatRequestId }, ADA);
          await new Promise((resolve) => setTimeout(resolve, 2));
          await context.app.requestSeatAccess(scope, lena.caller);
        }
        return row;
      };

      const refusal = await context.app
        .approveSeatRequest({ ...scope, seatRequestId }, ADA)
        .catch((error: unknown) => error);

      expect(codeOf(refusal)).toBe("seat_request_not_found");
      expect((await context.openRequests()).map((open) => open.id)).toEqual([seatRequestId]);
      expect(context.membershipOf(lena.userId)?.role).toBe(OrganizationUserRole.EXTERNAL);
    });
  });
});

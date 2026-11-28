/**
 * An approval with a seat that cannot buy one: a held Lite Member, a payment reference the
 * approval never handed out, and a plan that does not pay per seat in Stripe.
 * @see modules/organization/specs/seat-requests.feature
 */
import { HandledError } from "@langwatch/handled-error";
import { nowInstant } from "@langwatch/time";
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

  describe.each([
    { pools: "a full seat free", freeFull: 1 },
    { pools: "no full seat free", freeFull: 0 },
  ])("when a held Lite Member is approved with no Lite seat free and $pools", ({ freeFull }) => {
    /** @scenario "A held Lite Member with no Lite seat free is refused without buying a full seat" */
    it("refuses and buys no full seat, which would not free a Lite one", async () => {
      const context = await application({ ...stripe, freeFull });
      const hana = context.liteMember({ email: "hana@acme.example" });
      await context.app.requestSeatAccess(scope, hana.caller);
      const [request] = await context.openRequests();
      const row = context.membershipOf(hana.userId);
      if (!row) throw new Error("expected Hana's membership");
      row.disabledAt = nowInstant();

      const refusal = await context.app
        .approveSeatRequestWithSeat({ ...scope, seatRequestId: request!.id }, ADA)
        .catch((error: unknown) => error);

      expect(codeOf(refusal)).toBe("member_seat_limit_reached");
      expect(HandledError.isHandled(refusal) && refusal.meta).toMatchObject({
        limitType: "membersLite",
      });
      expect(context.seatBilling.purchases).toBe(0);
    });
  });

  describe("when the payment reference is not one an approval handed out", () => {
    /** @scenario "A payment reference that does not parse is refused" */
    it("refuses with validation_error and approves nothing", async () => {
      const { app, seatRequestId, openRequests } = await lenaAsking();

      const refusals = await Promise.all(
        ["not json", JSON.stringify({ kind: "coupon" })].map((paymentRef) =>
          app
            .completeSeatApproval({ ...scope, seatRequestId, paymentRef }, ADA)
            .catch((error: unknown) => error),
        ),
      );

      expect(refusals.map(codeOf)).toEqual(["validation_error", "validation_error"]);
      expect(await openRequests()).toHaveLength(1);
    });
  });

  describe("when the payment reference names another open invoice of the organization", () => {
    const OTHER_INVOICE = { kind: "invoice", invoiceId: "in_other", seats: 9 } as const;

    /** @scenario "Completing an approval settles only the payment that approval recorded" */
    it("settles only the invoice the approval recorded, never the one the reference names", async () => {
      const { app, seatRequestId, seatBilling } = await lenaAsking();
      seatBilling.purchase = "payment_required";
      seatBilling.payment = "failed";
      const waiting = await app.approveSeatRequestWithSeat({ ...scope, seatRequestId }, ADA);
      if (waiting.status !== "payment_required") throw new Error("expected a Stripe page");
      const { openedAt } = JSON.parse(waiting.paymentRef) as { openedAt: number };
      const forged = JSON.stringify({ payment: OTHER_INVOICE, openedAt });

      const done = await app.completeSeatApproval(
        { ...scope, seatRequestId, paymentRef: forged },
        ADA,
      );

      expect(done).toEqual({ status: "failed" });
      expect(
        seatBilling.settled.map((payment) => payment.kind === "invoice" && payment.invoiceId),
      ).toEqual(["in_seat"]);
    });

    /** @scenario "Completing an approval settles only the payment that approval recorded" */
    it("refuses with validation_error and settles nothing when no approval waits on the opening", async () => {
      const { app, seatRequestId, seatBilling, seatRequests, openRequests } = await lenaAsking();
      const { openedAt } = await seatRequests.getOpen({ ...scope, id: seatRequestId });
      const forged = JSON.stringify({ payment: OTHER_INVOICE, openedAt });

      const refusal = await app
        .completeSeatApproval({ ...scope, seatRequestId, paymentRef: forged }, ADA)
        .catch((error: unknown) => error);

      expect(codeOf(refusal)).toBe("validation_error");
      expect(seatBilling.settled).toEqual([]);
      expect(await openRequests()).toHaveLength(1);
    });
  });

  describe("when the organization is on the free plan instead", () => {
    /** @scenario "Approve with a seat where the organization does not pay per seat in Stripe buys nothing" */
    it("refuses with member_seat_limit_reached and buys nothing", async () => {
      const { app, seatRequestId, seatBilling } = await lenaAsking({ isSaas: true });

      const refusal = await app
        .approveSeatRequestWithSeat({ ...scope, seatRequestId }, ADA)
        .catch((error: unknown) => error);

      expect(codeOf(refusal)).toBe("member_seat_limit_reached");
      expect(seatBilling.purchases).toBe(0);
    });
  });
});

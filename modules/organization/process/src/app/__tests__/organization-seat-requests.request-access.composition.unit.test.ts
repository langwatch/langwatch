/**
 * A Lite Member asks for a full seat from a refusal, hears the answer, and an approval buys the
 * seat it needs in one click.
 * @see modules/organization/specs/seat-requests.feature
 */
import { HandledError } from "@langwatch/handled-error";
import { OrganizationUserRole } from "@langwatch/organization-contract";
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

describe("given a Lite Member refused for want of a full seat", () => {
  describe("when she asks for access from the refusal", () => {
    /** @scenario "A Lite Member asks for a full seat from a refusal" */
    it("opens a requested seat request and mails the administrators and Billing members", async () => {
      const { app, liteMember, openRequests, mail } = await application();
      const lena = liteMember({ email: "lena@acme.example", name: "Lena Lite" });

      const answer = await app.requestSeatAccess(
        { ...scope, reason: "run the workbench" },
        lena.caller,
      );

      expect(answer.status).toBe("open");
      const [request] = await openRequests();
      expect(request).toMatchObject({
        email: "lena@acme.example",
        source: "requested",
        reason: "run the workbench",
      });
      expect(mail.seatRequests.map((sent) => sent.recipientEmail).toSorted()).toEqual([
        "ada@acme.example",
        "bill@acme.example",
      ]);
      expect(mail.seatRequests[0]).toMatchObject({
        personEmail: "lena@acme.example",
        heldWithoutAccess: false,
        askedFor: { reason: "run the workbench" },
      });
    });
  });

  describe("when she asks again while her request is open", () => {
    /** @scenario "Asking again while a request is open answers the same request" */
    it("answers the same request and mails nobody again", async () => {
      const { app, liteMember, openRequests, mail } = await application();
      const lena = liteMember({ email: "lena@acme.example" });
      await app.requestSeatAccess(scope, lena.caller);
      const mailed = mail.seatRequests.length;
      const [first] = await openRequests();

      const again = await app.requestSeatAccess({ ...scope, reason: "save a prompt" }, lena.caller);

      expect(again.status).toBe("open");
      expect((await openRequests()).map((open) => open.id)).toEqual([first!.id]);
      expect(mail.seatRequests).toHaveLength(mailed);
    });
  });

  describe("when her request was declined and she asks again", () => {
    /** @scenario "A member can ask again after a decline" */
    it("opens her request again", async () => {
      const { app, liteMember, openRequests } = await application();
      const lena = liteMember({ email: "lena@acme.example" });
      await app.requestSeatAccess(scope, lena.caller);
      const [request] = await openRequests();
      await app.declineSeatRequest({ ...scope, seatRequestId: request!.id }, ADA);

      const again = await app.requestSeatAccess(scope, lena.caller);

      expect(again.status).toBe("open");
      expect((await openRequests()).map((open) => open.email)).toEqual(["lena@acme.example"]);
    });
  });

  describe("when a full member asks", () => {
    /** @scenario "A full member who asks is refused with seat_request_full_member" */
    it("refuses with seat_request_full_member and opens nothing", async () => {
      const { app, openRequests } = await application();

      const refusal = await app.requestSeatAccess(scope, ADA).catch((error: unknown) => error);

      expect(codeOf(refusal)).toBe("seat_request_full_member");
      expect(await openRequests()).toEqual([]);
    });
  });

  describe("when a Lite Member whose account has no email address asks", () => {
    /** @scenario "A Lite Member with no email address is refused with seat_request_no_email" */
    it("refuses with seat_request_no_email and opens nothing", async () => {
      const { app, memory, liteMember, openRequests } = await application();
      const lena = liteMember({ email: "lena@acme.example" });
      const user = memory.users.get(lena.userId);
      if (user) user.email = null;

      const refusal = await app
        .requestSeatAccess(scope, lena.caller)
        .catch((error: unknown) => error);

      expect(codeOf(refusal)).toBe("seat_request_no_email");
      expect(await openRequests()).toEqual([]);
    });
  });

  describe("when she reads where her own request stands", () => {
    /** @scenario "A member reads where their own request stands" */
    it("reads none, then open, then approved", async () => {
      const { app, liteMember, openRequests } = await application({ freeFull: 1 });
      const lena = liteMember({ email: "lena@acme.example" });

      expect((await app.getMyAccessRequest(scope, lena.caller)).status).toBe("none");
      await app.requestSeatAccess(scope, lena.caller);
      expect((await app.getMyAccessRequest(scope, lena.caller)).status).toBe("open");
      const [request] = await openRequests();
      await app.approveSeatRequest({ ...scope, seatRequestId: request!.id }, ADA);

      const read = await app.getMyAccessRequest(scope, lena.caller);
      expect(read.status).toBe("approved");
      expect(read.resolvedAt).not.toBeNull();
    });
  });
});

describe("given a Lite Member with an open seat request", () => {
  describe("when an administrator approves it on a free seat", () => {
    /** @scenario "Approving mails the person that they have a full seat" */
    it("mails her that her full seat was approved", async () => {
      const { app, liteMember, openRequests, mail } = await application({ freeFull: 1 });
      const lena = liteMember({ email: "lena@acme.example" });
      await app.requestSeatAccess(scope, lena.caller);
      const [request] = await openRequests();

      await app.approveSeatRequest({ ...scope, seatRequestId: request!.id }, ADA);

      expect(mail.answers).toEqual([
        expect.objectContaining({ recipientEmail: "lena@acme.example", outcome: "approved" }),
      ]);
    });
  });

  describe("when an administrator declines it", () => {
    /** @scenario "Declining mails the person that it was declined" */
    it("mails her that an admin declined her request", async () => {
      const { app, liteMember, openRequests, mail } = await application();
      const lena = liteMember({ email: "lena@acme.example" });
      await app.requestSeatAccess(scope, lena.caller);
      const [request] = await openRequests();

      await app.declineSeatRequest({ ...scope, seatRequestId: request!.id }, ADA);

      expect(mail.answers).toEqual([
        expect.objectContaining({ recipientEmail: "lena@acme.example", outcome: "declined" }),
      ]);
    });
  });

  describe("when mail cannot be sent and an administrator declines it", () => {
    /** @scenario "An answer mail that cannot be sent leaves the answer standing" */
    it("still declines the request", async () => {
      const { app, liteMember, openRequests, mail } = await application();
      const lena = liteMember({ email: "lena@acme.example" });
      await app.requestSeatAccess(scope, lena.caller);
      const [request] = await openRequests();
      mail.failAnswers = true;

      const answer = await app.declineSeatRequest({ ...scope, seatRequestId: request!.id }, ADA);

      expect(answer.outcome).toBe("declined");
      expect((await app.getMyAccessRequest(scope, lena.caller)).status).toBe("declined");
    });
  });
});

describe("given a refused sign-in with no membership", () => {
  describe("when an administrator declines its request", () => {
    /** @scenario "A refused sign-in is never mailed the answer" */
    it("mails no answer", async () => {
      const { app, openRequests, mail } = await application();
      await app.recordRefusedSignIn({ ...scope, email: "late@acme.example", idp: "okta" });
      const [request] = await openRequests();

      await app.declineSeatRequest({ ...scope, seatRequestId: request!.id }, ADA);

      expect(mail.answers).toEqual([]);
    });
  });
});

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

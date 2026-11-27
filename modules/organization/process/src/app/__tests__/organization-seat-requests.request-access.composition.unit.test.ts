/**
 * A Lite Member asks for a full seat from a refusal and hears the answer.
 * @see modules/organization/specs/seat-requests.feature
 */
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";

import { ADA, application, ORGANIZATION_ID } from "./support/seat-requests-application.ts";

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

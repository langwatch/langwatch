/**
 * The in-app side of a member's own seat request: administrators and Billing members get a push
 * when a member asks, and the member gets one with the answer.
 * @see modules/organization/specs/seat-requests.feature
 */
import { describe, expect, it } from "vitest";

import { ADA, application, BILL, ORGANIZATION_ID } from "./support/seat-requests-application.ts";

const scope = { organizationId: ORGANIZATION_ID };

describe("given a Lite Member who asks for a full seat", () => {
  describe("when she asks for access to run the workbench", () => {
    /** @scenario "Administrators and Billing members get an in-app push when a member asks" */
    it("pushes each administrator and Billing member once that day", async () => {
      const { app, liteMember, openRequests, push } = await application();
      const lena = liteMember({ email: "lena@acme.example", name: "Lena Lite" });

      await app.requestSeatAccess({ ...scope, reason: "run the workbench" }, lena.caller);
      await app.requestSeatAccess({ ...scope, reason: "save a prompt" }, lena.caller);

      const [request] = await openRequests();
      expect(push.pushes.map((sent) => sent.userId).toSorted()).toEqual(
        [ADA.id, BILL.id].toSorted(),
      );
      for (const sent of push.pushes) {
        expect(sent).toMatchObject({
          organizationId: ORGANIZATION_ID,
          title: "Lena Lite asked for a full seat",
          body: "To run the workbench",
          url: "/settings/directory?tab=people",
          topic: `seat-request:${request!.id}`,
        });
        expect(sent.idempotencyKey).toMatch(
          new RegExp(`^seat-request-push:${request!.id}:${sent.userId}:\\d{4}-\\d{2}-\\d{2}$`),
        );
      }
    });
  });

  describe("when pushes cannot be sent", () => {
    /** @scenario "A push that cannot be sent leaves the request standing" */
    it("opens her request and still mails the administrators", async () => {
      const { app, liteMember, openRequests, push, mail } = await application();
      push.failPushes = true;
      const lena = liteMember({ email: "lena@acme.example" });

      const answer = await app.requestSeatAccess(scope, lena.caller);

      expect(answer.status).toBe("open");
      expect(await openRequests()).toHaveLength(1);
      expect(mail.seatRequests.map((sent) => sent.recipientEmail).toSorted()).toEqual([
        "ada@acme.example",
        "bill@acme.example",
      ]);
    });
  });
});

describe("given a Lite Member with an open request she asked for", () => {
  describe("when an administrator approves or declines it", () => {
    /** @scenario "The member who asked gets an in-app push with the answer" */
    it("pushes her the answer, once per answer", async () => {
      const approved = await application({ freeFull: 1 });
      const lena = approved.liteMember({ email: "lena@acme.example" });
      await approved.app.requestSeatAccess(scope, lena.caller);
      const [request] = await approved.openRequests();
      approved.push.pushes.length = 0;

      await approved.app.approveSeatRequest({ ...scope, seatRequestId: request!.id }, ADA);

      expect(approved.push.pushes).toEqual([
        expect.objectContaining({
          userId: lena.userId,
          title: "Your seat request was approved",
          url: "/",
          idempotencyKey: `seat-request-answer-push:${request!.id}:approved`,
        }),
      ]);

      const declined = await application();
      const lea = declined.liteMember({ email: "lea@acme.example" });
      await declined.app.requestSeatAccess(scope, lea.caller);
      const [declinedRequest] = await declined.openRequests();
      declined.push.pushes.length = 0;

      await declined.app.declineSeatRequest({ ...scope, seatRequestId: declinedRequest!.id }, ADA);

      expect(declined.push.pushes).toEqual([
        expect.objectContaining({ userId: lea.userId, title: "Your seat request was declined" }),
      ]);
    });
  });

  describe("when pushes cannot be sent and an administrator declines it", () => {
    /** @scenario "An answer push that cannot be sent leaves the answer standing" */
    it("declines the request all the same", async () => {
      const { app, liteMember, openRequests, push } = await application();
      const lena = liteMember({ email: "lena@acme.example" });
      await app.requestSeatAccess(scope, lena.caller);
      const [request] = await openRequests();
      push.failPushes = true;

      const answer = await app.declineSeatRequest({ ...scope, seatRequestId: request!.id }, ADA);

      expect(answer.outcome).toBe("declined");
      expect(await openRequests()).toEqual([]);
    });
  });
});

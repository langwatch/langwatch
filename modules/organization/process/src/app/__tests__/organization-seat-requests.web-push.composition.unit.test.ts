/**
 * The in-app side of a member's own seat request: administrators and Billing members get a push
 * when a member asks, and the member gets one with the answer.
 * @see modules/organization/specs/seat-requests.feature
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ADA,
  application,
  BILL,
  ORGANIZATION_ID,
  PROJECT_ID,
} from "./support/seat-requests-application.ts";

const scope = { organizationId: ORGANIZATION_ID };

describe("given a Lite Member who asks for a full seat", () => {
  describe("when she asks for access to run the workbench", () => {
    /** @scenario "Administrators and Billing members get an in-app push when a member asks" */
    it("pushes each administrator and Billing member once that day", async () => {
      const { app, liteMember, openRequests, push } = await application();
      const lena = liteMember({ email: "lena@acme.example", name: "Lena Lite" });

      await app.requestSeatAccess({ ...scope, reason: "run_experiments" }, lena.caller);
      await app.requestSeatAccess({ ...scope, reason: "save_prompts" }, lena.caller);

      const [request] = await openRequests();
      expect(push.pushes.map((sent) => sent.userId).toSorted()).toEqual(
        [ADA.id, BILL.id].toSorted(),
      );
      for (const sent of push.pushes) {
        expect(sent).toMatchObject({
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          title: "Lena Lite asked for a full seat",
          body: "To run and save experiments",
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

describe("given an organization with no project yet", () => {
  describe("when a Lite Member asks for access", () => {
    /** @scenario "An organization with no project yet gets no push and is still mailed" */
    it("pushes nobody and still mails the administrators", async () => {
      const { app, liteMember, push, mail } = await application({ withProject: false });
      const lena = liteMember({ email: "lena@acme.example" });

      await app.requestSeatAccess(scope, lena.caller);

      expect(push.pushes).toEqual([]);
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
          idempotencyKey: `seat-request-answer-push:${request!.id}:${request!.openedAt}:approved`,
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

  describe("when her request is declined, she asks again and it is declined again", () => {
    /** @scenario "The member who asked gets an in-app push with the answer" */
    it("pushes her each answer under its own key", async () => {
      const { app, liteMember, openRequests, push } = await application();
      const lena = liteMember({ email: "lena@acme.example" });
      await app.requestSeatAccess(scope, lena.caller);
      const [first] = await openRequests();
      await app.declineSeatRequest({ ...scope, seatRequestId: first!.id }, ADA);
      await new Promise((resolve) => setTimeout(resolve, 2));
      await app.requestSeatAccess(scope, lena.caller);
      const [second] = await openRequests();

      await app.declineSeatRequest({ ...scope, seatRequestId: second!.id }, ADA);

      const answers = push.pushes.filter((sent) => sent.userId === lena.userId);
      expect(second!.id).toBe(first!.id);
      expect(answers).toHaveLength(2);
      expect(new Set(answers.map((sent) => sent.idempotencyKey)).size).toBe(2);
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

describe("given a Lite Member whose arrival already opened a seat request", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function arrivedThenAsked({ nextDay }: { nextDay: boolean }) {
    const context = await application({ freeLite: 1 });
    const { userId } = await context.arrive({ email: "lena@acme.example" });
    const [arrival] = await context.openRequests();
    if (nextDay) {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000);
    }
    const caller = { id: userId, name: null, email: "lena@acme.example" };
    await context.app.requestSeatAccess({ ...scope, reason: "run_experiments" }, caller);
    return { ...context, userId, arrival: arrival! };
  }

  describe("when she presses Request access on a later day", () => {
    /** @scenario "Administrators and Billing members get an in-app push when a member asks" */
    it("pushes the administrators and Billing members about the same request", async () => {
      const { push, arrival, openRequests } = await arrivedThenAsked({ nextDay: true });

      expect(arrival.source).toBe("lite");
      expect((await openRequests()).map((open) => open.id)).toEqual([arrival.id]);
      expect(push.pushes.map((sent) => sent.userId).toSorted()).toEqual(
        [ADA.id, BILL.id].toSorted(),
      );
    });
  });

  describe("when she presses Request access the same day her arrival was mailed", () => {
    /** @scenario "Administrators and Billing members get an in-app push when a member asks" */
    it("still pushes the administrators and Billing members about her ask", async () => {
      const { push, arrival } = await arrivedThenAsked({ nextDay: false });

      const asked = push.pushes.filter((sent) => sent.topic === `seat-request:${arrival.id}`);
      expect(asked.map((sent) => sent.userId).toSorted()).toEqual([ADA.id, BILL.id].toSorted());
      expect(asked[0]?.body).toBe("To run and save experiments");
    });
  });

  describe("when she presses Request access and an administrator declines it", () => {
    /** @scenario "The member who asked gets an in-app push with the answer" */
    it("keeps the request as hers and pushes her the answer", async () => {
      const { app, push, arrival, userId, openRequests } = await arrivedThenAsked({
        nextDay: false,
      });
      const [request] = await openRequests();
      expect(request).toMatchObject({ id: arrival.id, source: "requested" });

      await app.declineSeatRequest({ ...scope, seatRequestId: arrival.id }, ADA);

      expect(push.pushes).toContainEqual(
        expect.objectContaining({ userId, title: "Your seat request was declined" }),
      );
    });
  });
});

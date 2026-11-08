/**
 * Seat requests as `OrganizationModule.create` composes them: the approval path, who is told,
 * and what a held person reads.
 * @see modules/organization/specs/seat-requests.feature
 */
import { describe, expect, it } from "vitest";

import { REFUSED_SIGN_IN_DAILY_CAP } from "../../services/seat-request.service.ts";
import { ADA, application, ORGANIZATION_ID } from "./support/seat-requests-application.ts";

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

describe("given an account-managed cloud organization whose notice log is down", () => {
  describe("when a seat request opens", () => {
    /** @scenario "Sales still hear about a seat request whose notice could not be recorded" */
    it("keeps the request open and still tells sales", async () => {
      const { arrive, openRequests, salesNotices } = await application({
        isSaas: true,
        noticesDown: true,
        plan: { planSource: "license", type: "ENTERPRISE", free: false },
      });

      await arrive({ email: "late@acme.example" });

      expect((await openRequests()).map((request) => request.email)).toEqual(["late@acme.example"]);
      expect(salesNotices).toHaveLength(1);
    });
  });
});

describe("given an organization refused at sign-in by many typed addresses in a day", () => {
  describe("when one more address is refused past the daily cap", () => {
    /** @scenario "Refused sign-ins stop opening requests and mailing past a daily cap" */
    it("answers seat_limit but opens no request and mails nobody about it", async () => {
      const { app, mail, openRequests } = await application();
      const refuse = (email: string) =>
        app.recordRefusedSignIn({ organizationId: ORGANIZATION_ID, email, idp: "okta" });
      for (let index = 0; index < REFUSED_SIGN_IN_DAILY_CAP; index++) {
        await refuse(`typed-${index}@acme.example`);
      }
      const mailedBefore = mail.seatRequests.length;

      const answer = await refuse("one-more@acme.example");

      expect(answer).toEqual({ outcome: "seat_limit" });
      expect(await openRequests()).toHaveLength(REFUSED_SIGN_IN_DAILY_CAP);
      expect(mail.seatRequests).toHaveLength(mailedBefore);
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

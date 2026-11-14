/**
 * The mail behind seat requests and refused sign-ins (ruling R5).
 * @see modules/organization/specs/seat-requests.feature
 */
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import { MemoryAccessNoticeMailChannel } from "../../channels/memory/memory.access-notice-mail.channel.ts";
import { MemoryOrganizationAccessNoticeRepository } from "../../repositories/memory/memory.organization-access-notice.repository.ts";
import { OrganizationAccessNoticeService } from "../organization-access-notice.service.ts";

const ORGANIZATION_ID = "org-acme";
const HOUR_MS = 60 * 60 * 1000;
const START = Date.UTC(2026, 10, 6, 9);

function notices() {
  const clock = { now: START };
  const outage = { recipients: false, nobody: false, bouncing: new Set<string>() };
  let ids = 0;
  const repository = MemoryOrganizationAccessNoticeRepository.create();
  const mail = MemoryAccessNoticeMailChannel.create();
  const deliver = mail.sendSeatRequest.bind(mail);
  mail.sendSeatRequest = async (input) => {
    if (outage.bouncing.has(input.recipientEmail)) throw new Error("mailbox unavailable");
    await deliver(input);
  };
  const service = OrganizationAccessNoticeService.create({
    notices: repository,
    mail,
    context: {
      recipients: async () => {
        if (outage.recipients) throw new Error("recipients unavailable");
        if (outage.nobody) return [];
        return [
          { userId: "user-ada", email: "ada@acme.example" },
          { userId: "user-bill", email: "bill@acme.example" },
        ];
      },
      organizationName: async () => "ACME",
      approval: async () => ({ kind: "contact_sales" }),
    },
    requestsUrl: "https://app.langwatch.test/settings/members?tab=requests",
    now: () => clock.now,
    newId: () => `notice-${++ids}`,
    logger: createTestLogger().logger,
  });
  const seatRequest = (email: string) =>
    service.record({
      organizationId: ORGANIZATION_ID,
      kind: "seat_request",
      email,
      name: null,
      idp: null,
      idpRefused: false,
    });
  return { clock, mail, outage, service, seatRequest };
}

describe("OrganizationAccessNoticeService", () => {
  describe("when two different people ask for a seat an hour apart", () => {
    /** @scenario "Each person's notice is mailed at once" */
    it("mails every recipient about each person, one mail per person", async () => {
      const { clock, mail, seatRequest } = notices();

      const first = await seatRequest("first@acme.example");
      clock.now += HOUR_MS;
      const second = await seatRequest("second@acme.example");

      expect([first, second]).toEqual([
        { recorded: true, mailed: true },
        { recorded: true, mailed: true },
      ]);
      expect(mail.seatRequests.map((sent) => [sent.recipientEmail, sent.personEmail])).toEqual([
        ["ada@acme.example", "first@acme.example"],
        ["bill@acme.example", "first@acme.example"],
        ["ada@acme.example", "second@acme.example"],
        ["bill@acme.example", "second@acme.example"],
      ]);
    });
  });

  describe("when the identity provider refuses the same person three times in a day", () => {
    /** @scenario "The same person is noticed at most once a day per kind" */
    it("records one notice naming them", async () => {
      const { mail, service } = notices();
      const refuse = () =>
        service.record({
          organizationId: ORGANIZATION_ID,
          kind: "idp_refused",
          email: "late@acme.example",
          name: null,
          idp: "okta",
          idpRefused: true,
        });

      const results = [await refuse(), await refuse(), await refuse()];

      expect(results.map((result) => result.recorded)).toEqual([true, false, false]);
      expect(mail.idpRefusals.map((sent) => sent.recipientEmail)).toEqual([
        "ada@acme.example",
        "bill@acme.example",
      ]);
    });
  });

  describe("when the seat request comes from a sign-in the identity provider refused", () => {
    it("names the provider in the mail it sends", async () => {
      const { mail, service } = notices();

      await service.record({
        organizationId: ORGANIZATION_ID,
        kind: "seat_request",
        email: "late@acme.example",
        name: null,
        idp: "okta",
        idpRefused: true,
      });

      expect(mail.seatRequests[0]?.idpRefused).toEqual({ idpName: "Okta" });
    });
  });

  describe("when no mail about a notice could be sent", () => {
    /** @scenario "A notice whose mail reached nobody is retried by the next arrival that day" */
    it("mails it when the same person arrives again that day", async () => {
      const { clock, mail, outage, seatRequest } = notices();
      outage.bouncing = new Set(["ada@acme.example", "bill@acme.example"]);

      const first = await seatRequest("late@acme.example");
      outage.bouncing.clear();
      clock.now += HOUR_MS;
      const second = await seatRequest("late@acme.example");

      expect([first, second]).toEqual([
        { recorded: true, mailed: false },
        { recorded: true, mailed: true },
      ]);
      expect(mail.seatRequests.map((sent) => sent.recipientEmail)).toEqual([
        "ada@acme.example",
        "bill@acme.example",
      ]);
    });

    /** @scenario "A notice whose mail reached nobody is retried by the next arrival that day" */
    it("retries a notice whose recipients could not be read", async () => {
      const { mail, outage, seatRequest } = notices();
      outage.recipients = true;

      const first = await seatRequest("late@acme.example");
      outage.recipients = false;
      const second = await seatRequest("late@acme.example");

      expect([first.mailed, second.mailed]).toEqual([false, true]);
      expect(mail.seatRequests).toHaveLength(2);
    });
  });

  describe("when the organization has no one to mail yet", () => {
    /** @scenario "A notice whose mail reached nobody is retried by the next arrival that day" */
    it("keeps the notice unmailed, so a later arrival that day mails it", async () => {
      const { mail, outage, seatRequest } = notices();
      outage.nobody = true;

      const first = await seatRequest("late@acme.example");
      outage.nobody = false;
      const second = await seatRequest("late@acme.example");

      expect([first.mailed, second.mailed]).toEqual([false, true]);
      expect(mail.seatRequests).toHaveLength(2);
    });
  });

  describe("when the mail reached one recipient and bounced for the other", () => {
    /** @scenario "A notice that reached one recipient is not mailed again that day" */
    it("keeps the notice as mailed", async () => {
      const { mail, outage, seatRequest } = notices();
      outage.bouncing = new Set(["ada@acme.example"]);

      const first = await seatRequest("late@acme.example");
      outage.bouncing.clear();
      const second = await seatRequest("late@acme.example");

      expect([first, second]).toEqual([
        { recorded: true, mailed: true },
        { recorded: false, mailed: false },
      ]);
      expect(mail.seatRequests.map((sent) => sent.recipientEmail)).toEqual(["bill@acme.example"]);
    });
  });
});

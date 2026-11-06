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
  let ids = 0;
  const repository = MemoryOrganizationAccessNoticeRepository.create();
  const mail = MemoryAccessNoticeMailChannel.create();
  const service = OrganizationAccessNoticeService.create({
    notices: repository,
    mail,
    context: {
      recipients: async () => [
        { userId: "user-ada", email: "ada@acme.example" },
        { userId: "user-bill", email: "bill@acme.example" },
      ],
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
  return { clock, mail, service, seatRequest };
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
});

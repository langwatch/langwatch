/**
 * The bounded mail behind seat requests and refused sign-ins (ruling R5).
 * @see modules/organization/specs/seat-requests.feature
 */
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import { MemoryAccessNoticeMailChannel } from "../../channels/memory/memory.access-notice-mail.channel.ts";
import { MemoryOrganizationAccessNoticeRepository } from "../../repositories/memory/memory.organization-access-notice.repository.ts";
import {
  ACCESS_NOTICE_WINDOW_MS,
  OrganizationAccessNoticeService,
} from "../organization-access-notice.service.ts";

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
  describe("when the first notice of the window is recorded", () => {
    it("mails every recipient at once", async () => {
      const { mail, seatRequest } = notices();

      const result = await seatRequest("late@acme.example");

      expect(result).toEqual({ recorded: true, mailed: true });
      expect(mail.seatRequests.map((sent) => sent.recipientEmail)).toEqual([
        "ada@acme.example",
        "bill@acme.example",
      ]);
    });
  });

  describe("when more notices arrive within the window", () => {
    /** @scenario "Later notices in the same window are held for one digest" */
    it("mails none at once and sends one digest naming both when the window closes", async () => {
      const { clock, mail, service, seatRequest } = notices();
      await seatRequest("first@acme.example");
      clock.now += HOUR_MS;

      await seatRequest("second@acme.example");
      await seatRequest("third@acme.example");

      expect(mail.seatRequests).toHaveLength(2);
      expect(await service.sendDueDigests()).toEqual({ digests: 0 });

      clock.now = START + ACCESS_NOTICE_WINDOW_MS;
      expect(await service.sendDueDigests()).toEqual({ digests: 1 });
      expect(mail.digests.map((digest) => digest.recipientEmail)).toEqual([
        "ada@acme.example",
        "bill@acme.example",
      ]);
      expect(mail.digests[0]?.people.map((person) => person.email)).toEqual([
        "second@acme.example",
        "third@acme.example",
      ]);
      expect(await service.sendDueDigests()).toEqual({ digests: 0 });
    });
  });

  describe("when a notice arrives after the window closed but before the sweep", () => {
    /** @scenario "A notice after the window closed carries the ones still held" */
    it("mails one digest naming the held person and the new one", async () => {
      const { clock, mail, service, seatRequest } = notices();
      await seatRequest("first@acme.example");
      clock.now += HOUR_MS;
      await seatRequest("second@acme.example");
      clock.now = START + ACCESS_NOTICE_WINDOW_MS + HOUR_MS;

      const result = await seatRequest("fourth@acme.example");

      expect(result).toEqual({ recorded: true, mailed: true });
      expect(mail.seatRequests).toHaveLength(2);
      expect(mail.digests[0]?.people.map((person) => person.email)).toEqual([
        "second@acme.example",
        "fourth@acme.example",
      ]);
      expect(await service.sendDueDigests()).toEqual({ digests: 0 });
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

  describe("when twenty-five notices are held for the digest", () => {
    /** @scenario "A digest names at most twenty people" */
    it("names twenty people and counts five more", async () => {
      const { clock, mail, service, seatRequest } = notices();
      await seatRequest("first@acme.example");
      for (let index = 0; index < 25; index++) {
        clock.now += 1_000;
        await seatRequest(`person-${index}@acme.example`);
      }

      clock.now = START + ACCESS_NOTICE_WINDOW_MS;
      await service.sendDueDigests();

      const [digest] = mail.digests;
      expect(digest?.people).toHaveLength(20);
      expect(digest?.moreCount).toBe(5);
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

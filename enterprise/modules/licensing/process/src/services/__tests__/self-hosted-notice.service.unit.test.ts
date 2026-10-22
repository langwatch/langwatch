// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Which notices Cloud sends an install, over the memory twin.
 * Spec: enterprise/modules/licensing/specs/self-hosted-notices.feature
 */
import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemorySelfHostedNoticeRepository } from "../../repositories/memory/memory.self-hosted-notice.repository.ts";
import { SelfHostedNoticeService } from "../self-hosted-notice.service.ts";

const START = Temporal.Instant.from("2026-10-21T10:00:00Z");

function setup() {
  let now: Instant = START;
  const repository = MemorySelfHostedNoticeRepository.create();
  const service = SelfHostedNoticeService.create({ repository, now: () => now });
  return {
    service,
    repository,
    advance: (minutes: number) => {
      now = now.add({ minutes });
    },
  };
}

const securityFix = {
  severity: "security" as const,
  title: "Upgrade to 3.4.2",
  body: "A vulnerability in trace sharing is fixed in 3.4.2.",
  url: "https://langwatch.ai/security/2026-10",
  fixedIn: "3.4.2",
  expiresAt: null,
};

describe("SelfHostedNoticeService", () => {
  describe("given one draft notice, one withdrawn notice and one published notice", () => {
    describe("when Cloud answers a usage report", () => {
      /** @scenario "A draft or withdrawn notice is never sent" */
      it("sends only the published notice", async () => {
        const { service } = setup();
        await service.create({ ...securityFix, title: "Still a draft" });
        const withdrawn = await service.create({ ...securityFix, title: "No longer true" });
        await service.publish({ id: withdrawn.id, operatorId: "user_olive" });
        await service.withdraw({ id: withdrawn.id });
        const published = await service.create(securityFix);
        await service.publish({ id: published.id, operatorId: "user_olive" });

        const sent = await service.findSent();

        expect(sent.map((notice) => notice.id)).toEqual([published.id]);
      });
    });
  });

  describe("given a published notice whose expiry has passed", () => {
    describe("when Cloud answers a usage report", () => {
      /** @scenario "An expired notice is no longer sent" */
      it("sends no notices", async () => {
        const { service, advance } = setup();
        const notice = await service.create({
          ...securityFix,
          expiresAt: START.add({ hours: 1 }).toString(),
        });
        await service.publish({ id: notice.id, operatorId: "user_olive" });
        await expect(service.findSent()).resolves.toHaveLength(1);

        advance(61);

        await expect(service.findSent()).resolves.toEqual([]);
      });
    });
  });

  describe("when staff publish a notice", () => {
    it("records who published it and when, and sends it in the install's wire shape", async () => {
      const { service, advance } = setup();
      const draft = await service.create(securityFix);
      advance(5);

      const published = await service.publish({ id: draft.id, operatorId: "user_olive" });

      expect(published).toMatchObject({
        status: "published",
        publishedBy: "user_olive",
        publishedAt: "2026-10-21T10:05:00.000Z",
      });
      await expect(service.findSent()).resolves.toEqual([
        {
          id: draft.id,
          severity: "security",
          title: "Upgrade to 3.4.2",
          body: "A vulnerability in trace sharing is fixed in 3.4.2.",
          url: "https://langwatch.ai/security/2026-10",
          fixed_in: "3.4.2",
          published_at: "2026-10-21T10:05:00.000Z",
        },
      ]);
    });

    it("keeps the first publication when it is published again", async () => {
      const { service, advance } = setup();
      const draft = await service.create(securityFix);
      await service.publish({ id: draft.id, operatorId: "user_olive" });
      advance(5);

      const again = await service.publish({ id: draft.id, operatorId: "user_pat" });

      expect(again).toMatchObject({
        publishedBy: "user_olive",
        publishedAt: "2026-10-21T10:00:00.000Z",
      });
    });
  });

  describe("when staff edit a published notice", () => {
    it("sends it as edited and keeps it published", async () => {
      const { service } = setup();
      const draft = await service.create(securityFix);
      await service.publish({ id: draft.id, operatorId: "user_olive" });

      await service.update({ id: draft.id, ...securityFix, title: "Upgrade to 3.4.2 now" });

      const [sent] = await service.findSent();
      expect(sent?.title).toBe("Upgrade to 3.4.2 now");
    });
  });

  describe("when staff act on a notice that does not exist", () => {
    it("refuses with not_found", async () => {
      const { service } = setup();

      await expect(
        service.publish({ id: "missing", operatorId: "user_olive" }),
      ).rejects.toMatchObject({ code: "not_found" });
    });
  });
});

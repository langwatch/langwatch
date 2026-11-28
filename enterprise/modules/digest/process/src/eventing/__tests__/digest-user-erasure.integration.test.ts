// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Clear digest rows on user erasure: user's erased fact reaches digest's own peer subscriber on
 * the real fold pipeline, which deletes the person's subscription, sends and folded weeks.
 * @see enterprise/modules/digest/specs/digest.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DigestUserErasureService } from "../../services/digest-user-erasure.service.ts";
import {
  installDigest,
  type InstalledDigest,
  MEMBER,
  ORGANIZATION,
  OTHER_MEMBER,
  PROJECT,
  SENT_WEEK,
  WAKE_AT,
} from "./digest.fixture.ts";

let digest: InstalledDigest;

beforeEach(() => {
  digest = installDigest();
});

afterEach(async () => {
  await digest.close();
});

/** One coding-agent session on the person's sent week, so a week row names them. */
const sessionOf = (userId: string) =>
  digest.recordUser({
    tenantId: PROJECT,
    occurredAt: WAKE_AT,
    organizationId: ORGANIZATION,
    isoWeek: SENT_WEEK,
    sourceKey: `session-${userId}`,
    userId,
    sessionId: `session-${userId}`,
    repository: null,
    series: null,
  });

const weekOwners = async () =>
  (
    await Promise.all(
      [MEMBER, OTHER_MEMBER].map((userId) =>
        digest.repositories.userWeeks.findWeeks({
          isoWeeks: [SENT_WEEK],
          organizationId: ORGANIZATION,
          userId,
        }),
      ),
    )
  )
    .flat()
    .map(({ userId }) => userId)
    .toSorted();

const isSent = (userId: string) =>
  digest.repositories.sends.isSent({ userId, organizationId: ORGANIZATION, isoWeek: SENT_WEEK });

/** Rows naming both people: an opt-out, a claimed send and a folded week each. */
async function rowsForBoth() {
  for (const userId of [MEMBER, OTHER_MEMBER]) {
    await digest.repositories.audience.unsubscribe({
      userId,
      sendId: `${userId}:${SENT_WEEK}`,
      at: WAKE_AT,
    });
    await digest.repositories.sends.claim({
      userId,
      organizationId: ORGANIZATION,
      isoWeek: SENT_WEEK,
      templateId: "digest-week",
      sentAt: WAKE_AT,
    });
    await sessionOf(userId);
  }
  await vi.waitFor(async () => {
    expect(await weekOwners()).toEqual([MEMBER, OTHER_MEMBER].toSorted());
  });
}

describe("digest rows on user erasure", () => {
  describe("when user records a person erased, delivered twice", () => {
    /** @scenario "Digest rows naming an erased person are cleared" */
    it("deletes the person's subscription, sends and weeks and keeps the other person's", async () => {
      await rowsForBoth();

      await digest.userErased({ userId: MEMBER });
      await digest.userErased({ userId: MEMBER });

      await vi.waitFor(async () => {
        expect(await weekOwners()).toEqual([OTHER_MEMBER]);
      });
      expect(
        await digest.repositories.audience.findUnsubscribed({ userIds: [MEMBER, OTHER_MEMBER] }),
      ).toEqual([OTHER_MEMBER]);
      expect(await isSent(MEMBER)).toBe(false);
      expect(await isSent(OTHER_MEMBER)).toBe(true);
      expect(digest.mail).toEqual([]);
    });
  });

  describe("when digest clears rows for a person no digest row names", () => {
    /** @scenario "Clearing digest rows for a person digest holds nothing for changes nothing" */
    it("leaves every other row as it was", async () => {
      await rowsForBoth();
      // The subscriber's own handling, awaited directly so the assertion follows it.
      const erasure = DigestUserErasureService.create(digest.repositories);

      await erasure.forgetUser({ userId: "user-nobody" });

      expect(await weekOwners()).toEqual([MEMBER, OTHER_MEMBER].toSorted());
      expect(
        await digest.repositories.audience.findUnsubscribed({ userIds: [MEMBER, OTHER_MEMBER] }),
      ).toEqual([MEMBER, OTHER_MEMBER]);
      expect(await isSent(MEMBER)).toBe(true);
      expect(await isSent(OTHER_MEMBER)).toBe(true);
    });
  });
});

// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The week's trace numbers come from analytics, not span folds: what analytics answers is what
 * the email shows, and each project's week costs two reads however many members are sent to.
 * @see enterprise/modules/digest/specs/digest.feature
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ADMIN,
  installDigest,
  type InstalledDigest,
  MEMBER,
  ORGANIZATION,
  PROJECT,
  SENT_WEEK,
} from "./digest.fixture.ts";

let digest: InstalledDigest;

beforeEach(async () => {
  digest = installDigest();
  await digest.repositories.audience.setArmed({ armed: true });
});

afterEach(async () => {
  await digest.close();
});

const sendTo = (userId: string) =>
  digest.carryOut({ userId, organizationId: ORGANIZATION, isoWeek: SENT_WEEK });

describe("a member's traces email", () => {
  describe("when analytics answers a week for the project and the week before it", () => {
    /** @scenario "Trace numbers are read from analytics, never folded" */
    it("shows exactly the numbers analytics answered, the change on last week's traces", async () => {
      digest.world.traceNumbers.set(`${PROJECT}:${SENT_WEEK}`, {
        traces: 1_500,
        errors: 30,
        tokens: 2_000_000,
        costUsd: 12.5,
        p50Ms: 420.4,
        p95Ms: 3_100.2,
        models: { "gpt-5": 900, "claude-sonnet": 400 },
      });
      digest.world.traceNumbers.set(`${PROJECT}:2026-W45`, { traces: 1_000 });

      await sendTo(MEMBER);

      const [mail] = digest.mail;
      expect(mail?.templateId).toBe("digest-traces-week");
      expect(mail?.props).toMatchObject({
        traces: 1_500,
        changePercent: 50,
        errors: 30,
        tokens: 2_000_000,
        costUsd: 12.5,
        p50Milliseconds: 420,
        p95Milliseconds: 3_100,
        topModels: [
          { name: "gpt-5", calls: 900 },
          { name: "claude-sonnet", calls: 400 },
        ],
      });
    });
  });

  describe("when several members of the organization are sent the week", () => {
    /** @scenario "Trace numbers are read from analytics, never folded" */
    it("reads each project's week once, not once per member", async () => {
      digest.world.traceNumbers.set(`${PROJECT}:${SENT_WEEK}`, { traces: 10, models: { a: 10 } });

      await sendTo(ADMIN);
      await sendTo(MEMBER);

      expect(digest.world.analyticsReads.toSorted()).toEqual(
        [
          `${PROJECT}:${SENT_WEEK}`,
          `${PROJECT}:${SENT_WEEK}:grouped`,
          `${PROJECT}:2026-W45`,
        ].toSorted(),
      );
    });
  });

  describe("when analytics answers a quiet week", () => {
    /** @scenario "A quiet week sends nothing" */
    it("sends no traces email and asks for no model breakdown", async () => {
      await sendTo(MEMBER);

      expect(digest.mail).toEqual([]);
      expect(digest.world.analyticsReads.some((read) => read.endsWith(":grouped"))).toBe(false);
    });
  });
});

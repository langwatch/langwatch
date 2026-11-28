// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The week's trace numbers come from analytics, not span folds: what analytics answers is what
 * the email shows, and each project's week costs two reads however many members are sent to.
 * @see enterprise/modules/digest/specs/digest.feature
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RenderedDigestMail } from "../../channels/digest-mail.channel.ts";
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

/** The traces row of an email: the busiest visible project's week. */
const tracesRowOf = (mail: RenderedDigestMail) =>
  mail.props.rows.find((row) => row.kind === "traces");

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
      expect(mail?.templateId).toBe("digest-week");
      expect(mail?.props.rows.find((row) => row.kind === "traces")).toEqual({
        kind: "traces",
        projectName: "Support bot",
        traces: 1_500,
        previousTraces: 1_000,
        errors: 30,
        costUsd: 12.5,
        p95Milliseconds: 3_100,
        topModel: { name: "gpt-5", traces: 900 },
        url: "https://app.example.test/support-bot/traces",
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

  describe("when an admin is sent the week of an organization with projects they must not see", () => {
    const PERSONAL = "project-personal";
    const ARCHIVED = "project-archived";
    const GOVERNANCE = "project-governance";
    /** @scenario "An email counts only the live, shared or own projects the recipient may view" */
    it("shows and reads none of another member's personal, archived or governance projects", async () => {
      digest.world.projects = [PROJECT, PERSONAL, ARCHIVED, GOVERNANCE];
      digest.world.personalOwners.set(PERSONAL, MEMBER);
      digest.world.archivedProjects.add(ARCHIVED);
      digest.world.governanceProjects.add(GOVERNANCE);
      digest.world.traceNumbers.set(`${PROJECT}:${SENT_WEEK}`, { traces: 1_100 });
      for (const hidden of [PERSONAL, ARCHIVED, GOVERNANCE]) {
        digest.world.traceNumbers.set(`${hidden}:${SENT_WEEK}`, { traces: 99_999 });
      }

      await sendTo(ADMIN);

      expect(digest.mail.map(tracesRowOf)).toEqual([expect.objectContaining({ traces: 1_100 })]);
      expect(digest.world.analyticsReads.join(" ")).not.toMatch(/personal|archived|governance/);
    });

    /** @scenario "An aggregate project is never read for an email" */
    it("reads no aggregate project of the organization", async () => {
      const AGGREGATE = "project-aggregate";
      digest.world.projects = [PROJECT, AGGREGATE];
      digest.world.aggregateProjects.add(AGGREGATE);
      digest.world.traceNumbers.set(`${PROJECT}:${SENT_WEEK}`, { traces: 1_100 });
      digest.world.traceNumbers.set(`${AGGREGATE}:${SENT_WEEK}`, { traces: 99_999 });

      await sendTo(ADMIN);

      expect(digest.mail.map(tracesRowOf)).toEqual([expect.objectContaining({ traces: 1_100 })]);
      expect(digest.world.analyticsReads.join(" ")).not.toMatch(/aggregate/);
    });

    /** @scenario "An aggregate project is never read for an email" */
    it("sends nothing, and does not fail, to a member whose only project is an aggregate", async () => {
      const AGGREGATE = "project-aggregate";
      digest.world.projects = [AGGREGATE];
      digest.world.aggregateProjects.add(AGGREGATE);
      digest.world.traceNumbers.set(`${AGGREGATE}:${SENT_WEEK}`, { traces: 99_999 });

      await sendTo(MEMBER);

      expect(digest.mail).toEqual([]);
      expect(digest.world.analyticsReads).toEqual([]);
    });

    /** @scenario "An email counts only the live, shared or own projects the recipient may view" */
    it("still shows a member their own personal project", async () => {
      digest.world.projects = [PROJECT, PERSONAL];
      digest.world.personalOwners.set(PERSONAL, MEMBER);
      digest.world.traceNumbers.set(`${PROJECT}:${SENT_WEEK}`, { traces: 1_100 });
      digest.world.traceNumbers.set(`${PERSONAL}:${SENT_WEEK}`, { traces: 1_300 });

      await sendTo(MEMBER);

      expect(digest.mail.map(tracesRowOf)).toEqual([expect.objectContaining({ traces: 1_300 })]);
    });
  });

  describe("when the week before cannot be read", () => {
    /** @scenario "A failed read of last week drops the change line, not the email" */
    it("still sends the week, without its change on last week", async () => {
      digest.world.traceNumbers.set(`${PROJECT}:${SENT_WEEK}`, { traces: 1_500 });
      digest.world.failingAnalytics.add(`${PROJECT}:2026-W45`);

      await sendTo(MEMBER);

      const row = digest.mail.map(tracesRowOf)[0];
      expect(row).toMatchObject({ traces: 1_500 });
      expect(row).not.toHaveProperty("previousTraces");
    });
  });

  describe("when the sent week cannot be read", () => {
    /** @scenario "A failed read of the sent week fails the send for a retry" */
    it("sends nothing and claims nothing, so the retry can still send", async () => {
      digest.world.failingAnalytics.add(`${PROJECT}:${SENT_WEEK}`);

      await expect(sendTo(MEMBER)).rejects.toThrow("analytics cannot read");

      expect(digest.mail).toEqual([]);
      expect(
        await digest.repositories.sends.isSent({
          userId: MEMBER,
          organizationId: ORGANIZATION,
          isoWeek: SENT_WEEK,
        }),
      ).toBe(false);
    });
  });

  describe("when an organization has many projects", () => {
    /** @scenario "Analytics is read a few reads at a time" */
    it("never runs more than eight reads at once", async () => {
      const many = Array.from({ length: 30 }, (_, index) => `project-${index + 10}`);
      digest.world.projects = [PROJECT, ...many];
      digest.world.readDelayMs = 5;
      for (const project of digest.world.projects) {
        digest.world.traceNumbers.set(`${project}:${SENT_WEEK}`, {
          traces: 1_010,
          models: { a: 1_010 },
        });
      }

      await sendTo(MEMBER);

      expect(digest.world.mostReadsAtOnce).toBeGreaterThan(1);
      expect(digest.world.mostReadsAtOnce).toBeLessThanOrEqual(8);
    });
  });

  describe("when one project's week cannot be read but another's can", () => {
    /** @scenario "A project whose week cannot be read is left out of the email" */
    it("sends the email about the readable project alone", async () => {
      digest.world.projects = [PROJECT, "project-broken"];
      digest.world.traceNumbers.set(`${PROJECT}:${SENT_WEEK}`, { traces: 1_200 });
      digest.world.failingAnalytics.add(`project-broken:${SENT_WEEK}`);

      await sendTo(MEMBER);

      expect(digest.mail.map(tracesRowOf)).toEqual([expect.objectContaining({ traces: 1_200 })]);
    });
  });

  describe("when every visible project's week cannot be read", () => {
    /** @scenario "A send fails for a retry when no visible project's week can be read" */
    it("fails the send, unclaimed, rather than mailing an empty week", async () => {
      digest.world.projects = [PROJECT, "project-broken"];
      digest.world.failingAnalytics.add(`${PROJECT}:${SENT_WEEK}`);
      digest.world.failingAnalytics.add(`project-broken:${SENT_WEEK}`);

      await expect(sendTo(MEMBER)).rejects.toThrow("analytics cannot read");

      expect(digest.mail).toEqual([]);
    });
  });
});

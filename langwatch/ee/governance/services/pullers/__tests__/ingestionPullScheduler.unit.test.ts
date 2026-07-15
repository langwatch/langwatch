// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Unit coverage for pull-schedule validation and the structural guarantee
 * that puller scheduling goes through the durable ScheduledJob calendar
 * (croner-evaluated) — no BullMQ, no Linux cron, no self-re-arming chain.
 *
 * Spec: specs/ai-governance/puller-framework/calendar-scheduled-pulls.feature
 */
import { readFileSync } from "fs";
import { join } from "path";

import { describe, expect, it } from "vitest";

import { assertValidPullSchedule } from "../ingestionPullScheduler";

describe("ingestionPullScheduler — pull-schedule validation", () => {
  describe("given a five-field cron pullSchedule", () => {
    describe("when the source service validates it", () => {
      /** @scenario "Pull schedules are validated as five-field cron expressions" */
      it.each(["*/15 * * * *", "0 9 * * 1", "0 0 1 1 *"])(
        "accepts %s",
        (cron) => {
          expect(() => assertValidPullSchedule(cron)).not.toThrow();
        },
      );
    });
  });

  describe("given a malformed or seconds-resolution pullSchedule", () => {
    describe("when the source service validates it", () => {
      /** @scenario "Pull schedules are validated as five-field cron expressions" */
      it.each([
        "definitely not cron",
        "* * * * * *", // 6-field: croner would poll every second
        "",
        "0 25 * * *", // hour out of range
      ])("rejects %j", (cron) => {
        expect(() => assertValidPullSchedule(cron)).toThrow();
      });

      /** @scenario "Malformed schedules are rejected without touching the calendar" */
      it("throws before any calendar write can happen", () => {
        expect(() => assertValidPullSchedule("definitely not cron")).toThrow(
          /5-field cron expression/,
        );
      });
    });
  });

  describe("given the puller scheduling module", () => {
    describe("when its implementation is inspected", () => {
      /** @scenario "Scheduling uses the durable calendar, not Linux cron or BullMQ" */
      it("schedules through ScheduledJob rows with croner, never BullMQ or Linux cron", () => {
        const source = readFileSync(
          join(__dirname, "..", "ingestionPullScheduler.ts"),
          "utf8",
        );

        // Recurrence is owned by the durable calendar, evaluated by croner.
        expect(source).toMatch(/from ["']croner["']/);
        expect(source).toContain("PrismaScheduledJobRepository");
        expect(source).toContain("upsertForTarget");

        // No BullMQ, no Linux cron, no repeatable-job registration.
        expect(source).not.toMatch(/from ["']bullmq["']/);
        expect(source).not.toMatch(/node-cron|crontab/);
        expect(source).not.toMatch(/repeat(able)?\s*:/);
      });
    });
  });
});

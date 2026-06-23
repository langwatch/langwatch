// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Unit coverage for the in-process cron parsing that drives the event-sourced
 * pull scheduler. The recurrence fires on the event-sourcing global queue, not
 * Linux cron and not BullMQ — the cron string is only a schedule expression we
 * parse ourselves.
 *
 * Spec: specs/ai-governance/puller-framework/event-sourced-scheduling.feature
 */
import { readFileSync } from "fs";
import { join } from "path";

import { describe, expect, it } from "vitest";

import { computeNextDelayMs } from "../ingestionPullScheduler";

describe("ingestionPullScheduler — in-process cron scheduling", () => {
  describe("given a source with pullSchedule '*/15 * * * *'", () => {
    describe("when the scheduler computes when the next pull should fire", () => {
      /** @scenario "The cron schedule is parsed in-process and fired by event-sourcing, not Linux cron" */
      it("returns a delay equal to the cron's next fire time minus now", () => {
        const nowMs = Date.parse("2026-06-19T10:07:00Z");
        const expectedNextMs = Date.parse("2026-06-19T10:15:00Z");

        const delayMs = computeNextDelayMs("*/15 * * * *", nowMs);

        expect(delayMs).toBe(expectedNextMs - nowMs);
      });

      /** @scenario "The cron schedule is parsed in-process and fired by event-sourcing, not Linux cron" */
      it("schedules in-process with cron-parser, never Linux cron or a BullMQ repeatable job", () => {
        const source = readFileSync(
          join(__dirname, "..", "ingestionPullScheduler.ts"),
          "utf8",
        );

        // Parsed in-process with cron-parser.
        expect(source).toContain('from "cron-parser"');
        // No BullMQ, no Linux-cron runtime anywhere in the scheduler.
        expect(source).not.toMatch(/from ["']bullmq["']/);
        expect(source).not.toMatch(/from ["']node-cron["']/);
        expect(source).not.toMatch(/\bcrontab\b/);
      });
    });
  });

  describe("given a current time and a cron expression", () => {
    describe.each([
      {
        now: "2026-06-19T10:00:00Z",
        cron: "*/15 * * * *",
        next: "2026-06-19T10:15:00Z",
      },
      {
        now: "2026-06-19T10:07:00Z",
        cron: "*/15 * * * *",
        next: "2026-06-19T10:15:00Z",
      },
      {
        now: "2026-06-19T10:30:00Z",
        cron: "0 * * * *",
        next: "2026-06-19T11:00:00Z",
      },
    ])("when now is $now and pullSchedule is $cron", ({ now, cron, next }) => {
      /** @scenario "The next fire time is derived from the cron expression" */
      it(`derives the next fire time as ${next}`, () => {
        const nowMs = Date.parse(now);

        const nextFireMs = nowMs + computeNextDelayMs(cron, nowMs);

        expect(nextFireMs).toBe(Date.parse(next));
      });
    });
  });
});

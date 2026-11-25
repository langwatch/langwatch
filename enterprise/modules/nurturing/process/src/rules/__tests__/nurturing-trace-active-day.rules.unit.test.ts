// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/project-usage.feature
 */
import { describe, expect, it } from "vitest";

import { organizationUsageTraits } from "../nurturing-project-usage.rules.ts";
import {
  TRACE_ACTIVE_DAY_CLAIM_SECONDS,
  traceActiveDayCall,
  traceActiveDaysToSend,
} from "../nurturing-trace-active-day.rules.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 20, 12);
// Signed up 2026-11-07 at 23:00 UTC: 11-08 is signup day 1 by UTC calendar day.
const organizationCreatedAt = Date.UTC(2026, 10, 7, 23);

describe("traceActiveDaysToSend()", () => {
  /** @scenario "A sync sends trace_active_day for today and yesterday only" */
  it("answers the traced days of today and yesterday, never an older one", () => {
    const days = traceActiveDaysToSend({
      activeDays: ["2026-11-10", "2026-11-18", "2026-11-19", "2026-11-20"],
      now: NOW,
      organizationCreatedAt,
    });

    expect(days).toEqual(["2026-11-19", "2026-11-20"]);
  });

  /** @scenario "A sync sends trace_active_day for today and yesterday only" */
  it("still answers yesterday for a sync just past midnight", () => {
    const justPastMidnight = Date.UTC(2026, 10, 21, 0, 5);

    const days = traceActiveDaysToSend({
      activeDays: ["2026-11-20"],
      now: justPastMidnight,
      organizationCreatedAt,
    });

    expect(days).toEqual(["2026-11-20"]);
  });

  /** @scenario "A sync sends trace_active_day for today and yesterday only" */
  it("answers no day for an organization that did not trace today or yesterday", () => {
    expect(
      traceActiveDaysToSend({ activeDays: ["2026-11-17"], now: NOW, organizationCreatedAt }),
    ).toEqual([]);
  });

  /** @scenario "A sync sends trace_active_day for today and yesterday only" */
  it("drops a traced day before the signup day, which has no days_since_signup", () => {
    const signedUpToday = Date.UTC(2026, 10, 20, 10);

    const days = traceActiveDaysToSend({
      activeDays: ["2026-11-19", "2026-11-20"],
      now: NOW,
      organizationCreatedAt: signedUpToday,
    });

    expect(days).toEqual(["2026-11-20"]);
  });
});

describe("traceActiveDayCall()", () => {
  /** @scenario "Each member gets trace_active_day once per UTC day their organization traced" */
  it("tracks trace_active_day on the member with the date and the days since signup", () => {
    const { call } = traceActiveDayCall({
      userId: "member-1",
      day: "2026-11-19",
      organizationCreatedAt,
    });

    expect(call).toEqual({
      type: "track",
      userId: "member-1",
      event: "trace_active_day",
      messageId: "trace_active_day:member-1:2026-11-19",
      properties: { date: "2026-11-19", days_since_signup: 12 },
    });
  });

  /** @scenario "Each member gets trace_active_day once per UTC day their organization traced" */
  it("counts the days since signup as active_day_<n> does, by UTC calendar day", () => {
    const traits = organizationUsageTraits({
      projects: [],
      traces: {
        traceCount: 1,
        errorCount: 0,
        lastTraceAt: null,
        lastFailedTraceAt: null,
        activeDays: ["2026-11-08"],
      },
      now: NOW,
      organizationCreatedAt,
    });
    const { call } = traceActiveDayCall({
      userId: "member-1",
      day: "2026-11-08",
      organizationCreatedAt,
    });

    expect(traits).toMatchObject({ active_day_1: true });
    expect(call).toMatchObject({ properties: { days_since_signup: 1 } });
  });

  /** @scenario "trace_active_day is never sent twice for a member and day" */
  it("keys its claim and id on the member and the day only", () => {
    const of = (userId: string, day: string) =>
      traceActiveDayCall({ userId, day, organizationCreatedAt });

    expect(of("member-1", "2026-11-19").claimKey).toBe(of("member-1", "2026-11-19").claimKey);
    expect(of("member-1", "2026-11-19").claimKey).toBe(
      "nurturing:trace_active_day:member-1:2026-11-19",
    );
    expect(of("member-1", "2026-11-20").claimKey).not.toBe(of("member-1", "2026-11-19").claimKey);
    expect(of("member-2", "2026-11-19").claimKey).not.toBe(of("member-1", "2026-11-19").claimKey);
  });

  /** @scenario "trace_active_day is never sent twice for a member and day" */
  it("is claimed for longer than the two days a sync sends it for", () => {
    expect(TRACE_ACTIVE_DAY_CLAIM_SECONDS * 1000).toBeGreaterThan(2 * DAY_MS);
  });
});

/**
 * @vitest-environment node
 *
 * The recovery clock: day 0 at the failed charge, emails on 3, 7, 14 and 21, paused from 21.
 */
import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  accessStopsAt,
  dueNotice,
  isPlanPausedForRecovery,
  noticeKindOf,
  recoveryDay,
} from "../payment-recovery.rules.ts";

const DAY_0 = Temporal.Instant.from("2026-11-02T09:00:00Z");
const at = (days: number, hours = 0) => DAY_0.add({ hours: days * 24 + hours });

describe("recoveryDay", () => {
  it("counts whole days since the failed charge", () => {
    expect(recoveryDay({ startedAt: DAY_0, now: at(0, 23) })).toBe(0);
    expect(recoveryDay({ startedAt: DAY_0, now: at(3) })).toBe(3);
  });
});

describe("accessStopsAt", () => {
  it("is 21 days after day 0", () => {
    expect(accessStopsAt({ startedAt: DAY_0 }).toString()).toBe("2026-11-23T09:00:00Z");
  });
});

describe("dueNotice", () => {
  it("answers nothing for a new case before day 3", () => {
    expect(dueNotice({ startedAt: DAY_0, noticeDay: null, now: at(0) })).toEqual({ kind: "none" });
    expect(dueNotice({ startedAt: DAY_0, noticeDay: null, now: at(2, 23) })).toEqual({
      kind: "none",
    });
  });

  it("answers the day 3 email as a new case's first", () => {
    expect(dueNotice({ startedAt: DAY_0, noticeDay: null, now: at(3) })).toEqual({
      kind: "due",
      day: 3,
    });
  });

  it("answers nothing between notice days", () => {
    expect(dueNotice({ startedAt: DAY_0, noticeDay: 3, now: at(5) })).toEqual({ kind: "none" });
  });

  it("answers only the latest day reached when a day was missed", () => {
    expect(dueNotice({ startedAt: DAY_0, noticeDay: 3, now: at(15) })).toEqual({
      kind: "due",
      day: 14,
    });
  });

  it("answers nothing once day 21 was sent", () => {
    expect(dueNotice({ startedAt: DAY_0, noticeDay: 21, now: at(60) })).toEqual({ kind: "none" });
  });
});

describe("noticeKindOf", () => {
  it("maps each notice day to its email", () => {
    expect([3, 7, 14, 21].map((day) => noticeKindOf(day as 3))).toEqual([
      "failed",
      "reminder",
      "final",
      "paused",
    ]);
  });
});

describe("isPlanPausedForRecovery", () => {
  it("pauses a paid plan from day 21 on", () => {
    const paused = (now: Instant) =>
      isPlanPausedForRecovery({ startedAt: DAY_0, plan: "GROWTH_SEAT_EUR_MONTHLY", now });

    expect(paused(at(20, 23))).toBe(false);
    expect(paused(at(21))).toBe(true);
  });

  it("never pauses Enterprise or a subscription with no open case", () => {
    expect(isPlanPausedForRecovery({ startedAt: DAY_0, plan: "ENTERPRISE", now: at(40) })).toBe(
      false,
    );
    expect(isPlanPausedForRecovery({ startedAt: null, plan: "GROWTH", now: at(40) })).toBe(false);
  });
});

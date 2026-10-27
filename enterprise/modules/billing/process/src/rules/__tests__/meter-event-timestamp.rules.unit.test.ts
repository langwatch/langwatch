import { describe, expect, it } from "vitest";

import {
  METER_EVENT_MAX_AGE_DAYS,
  isMeterEventTooOld,
  meterEventTimestampSeconds,
} from "../meter-event-timestamp.rules.ts";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-04-15T12:00:00Z");

describe("the timestamp a meter event carries", () => {
  it("dates the event at the end of the period it covers", () => {
    const periodEndMs = Date.parse("2026-03-31T23:59:59Z");

    expect(meterEventTimestampSeconds({ periodEndMs, nowMs: now })).toBe(
      Math.floor(periodEndMs / 1000),
    );
  });

  it("falls back to now for a period older than the meter accepts", () => {
    const periodEndMs = now - (METER_EVENT_MAX_AGE_DAYS + 1) * MS_PER_DAY;

    expect(meterEventTimestampSeconds({ periodEndMs, nowMs: now })).toBe(Math.floor(now / 1000));
  });

  it("never dates an event ahead of the report that produced it", () => {
    const periodEndMs = now + MS_PER_DAY;

    expect(meterEventTimestampSeconds({ periodEndMs, nowMs: now })).toBe(Math.floor(now / 1000));
  });

  it("calls a period too old only once it is past the window", () => {
    expect(
      isMeterEventTooOld({ periodEndMs: now - METER_EVENT_MAX_AGE_DAYS * MS_PER_DAY, nowMs: now }),
    ).toBe(false);
    expect(
      isMeterEventTooOld({
        periodEndMs: now - (METER_EVENT_MAX_AGE_DAYS * MS_PER_DAY + 1),
        nowMs: now,
      }),
    ).toBe(true);
  });
});

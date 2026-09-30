/**
 * The 35-day window a meter event's timestamp has to fall inside.
 *
 * @see specs/self-hosting/connected-services/connected-billing.feature
 */

import { describe, expect, it } from "vitest";
import {
  isMeterEventTooOld,
  METER_EVENT_MAX_AGE_DAYS,
  meterEventTimestampSeconds,
} from "../services/meterEventTimestamp";

const NOW_MS = Date.parse("2026-06-10T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

describe("meterEventTimestampSeconds", () => {
  describe("given a period that ended inside the window", () => {
    it("dates the event at the end of the period", () => {
      const periodEndMs = NOW_MS - 3 * DAY_MS;

      expect(meterEventTimestampSeconds({ periodEndMs, nowMs: NOW_MS })).toBe(
        Math.floor(periodEndMs / 1000),
      );
    });

    it("accepts a period that ended exactly on the edge of the window", () => {
      const periodEndMs = NOW_MS - METER_EVENT_MAX_AGE_DAYS * DAY_MS;

      expect(meterEventTimestampSeconds({ periodEndMs, nowMs: NOW_MS })).toBe(
        Math.floor(periodEndMs / 1000),
      );
    });
  });

  describe("given a period older than the meter accepts", () => {
    /** @scenario "Usage older than the meter accepts is not sent with a stale timestamp" */
    it("dates the event at the time of reporting instead", () => {
      const periodEndMs = NOW_MS - (METER_EVENT_MAX_AGE_DAYS + 1) * DAY_MS;

      expect(meterEventTimestampSeconds({ periodEndMs, nowMs: NOW_MS })).toBe(
        Math.floor(NOW_MS / 1000),
      );
      expect(isMeterEventTooOld({ periodEndMs, nowMs: NOW_MS })).toBe(true);
    });
  });

  describe("given a period that has not ended yet", () => {
    it("dates the event now, never ahead of the report", () => {
      const periodEndMs = NOW_MS + 10 * DAY_MS;

      expect(meterEventTimestampSeconds({ periodEndMs, nowMs: NOW_MS })).toBe(
        Math.floor(NOW_MS / 1000),
      );
      expect(isMeterEventTooOld({ periodEndMs, nowMs: NOW_MS })).toBe(false);
    });
  });
});

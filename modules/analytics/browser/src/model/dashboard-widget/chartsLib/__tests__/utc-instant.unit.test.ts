/**
 * The charts library reads instants in plain arithmetic, not Temporal, to keep the polyfill out
 * of every widget frame; it must read them exactly as Temporal does.
 * @see modules/analytics/specs/dashboard-widget-gaps.feature
 */

import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { parseIsoInstant, utcParts } from "../utc-instant.ts";

/** Instants across leap years, month ends, the epoch and both sides of it, a minute apart. */
const SAMPLES = [
  -2_208_988_800_000, -86_400_001, -1, 0, 951_782_399_999, 951_782_400_000, 1_709_164_800_000,
  1_791_381_600_000, 1_798_761_599_999, 4_102_444_800_000,
].flatMap((epochMs) => [epochMs, epochMs + 61_123]);

describe("utcParts", () => {
  /** @scenario "The charts library reads instants without the Temporal polyfill" */
  it("gives the UTC fields Temporal gives", () => {
    for (const epochMs of SAMPLES) {
      const utc = Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO("UTC");
      expect(utcParts(epochMs)).toEqual({
        year: utc.year,
        month: utc.month,
        day: utc.day,
        hour: utc.hour,
        minute: utc.minute,
        second: utc.second,
      });
    }
  });
});

describe("parseIsoInstant", () => {
  /** @scenario "The charts library reads instants without the Temporal polyfill" */
  it("reads an instant with any offset as Temporal does", () => {
    for (const epochMs of SAMPLES) {
      const instant = Temporal.Instant.fromEpochMilliseconds(epochMs);
      expect(parseIsoInstant(instant.toString())).toBe(epochMs);
      expect(parseIsoInstant(instant.toString({ timeZone: "+05:30" }))).toBe(epochMs);
      expect(parseIsoInstant(instant.toString({ timeZone: "-08:00" }))).toBe(epochMs);
    }
    expect(parseIsoInstant("2026-10-07 14:00Z")).toBe(
      Temporal.Instant.from("2026-10-07T14:00:00Z").epochMilliseconds,
    );
  });

  /** @scenario "The charts library reads instants without the Temporal polyfill" */
  it("reads none from text that is not an instant", () => {
    for (const text of ["2026-10-07 00:00:00", "2026-02-30T00:00:00Z", "Oct 7", "", "25:00Z"]) {
      expect(parseIsoInstant(text)).toBeUndefined();
    }
  });
});

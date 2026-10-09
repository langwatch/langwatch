// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The "last arrived" column's wording, at its edges.
 *
 * WHY THIS FILE EXISTS. `fmtRelative` takes `Date | string`, and the string
 * arm is where the fleet's timestamps actually come in — serialized over the
 * wire, occasionally null, occasionally garbage. An unparsable one gave a
 * `NaN` difference, every `<` comparison against `NaN` returned false, and the
 * function fell all the way through to the days branch and printed "NaN days
 * ago" in the one column whose job is to say whether data is still arriving.
 * A timestamp a few seconds ahead of the client clock printed "-3 seconds
 * ago". Neither is a thing a reader can act on.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { fmtRelative } from "../IngestionSourcesTable";

const NOW = new Date("2026-03-01T12:00:00.000Z");

function at(offsetMs: number): string {
  return new Date(NOW.getTime() - offsetMs).toISOString();
}

afterEach(() => {
  vi.useRealTimers();
});

function freezeClock() {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
}

describe("given a timestamp the column can read", () => {
  describe("when it is in the past", () => {
    it("says how long ago, in whole units", () => {
      freezeClock();

      expect(fmtRelative(at(5_000))).toBe("5 seconds ago");
      expect(fmtRelative(at(60_000))).toBe("1 minute ago");
      expect(fmtRelative(at(3 * 3_600_000))).toBe("3 hours ago");
      expect(fmtRelative(at(2 * 86_400_000))).toBe("2 days ago");
    });
  });
});

describe("given a timestamp the column cannot use", () => {
  describe("when there is none", () => {
    it("says nothing rather than guessing", () => {
      expect(fmtRelative(null)).toBe("-");
    });
  });

  describe("when the string is not a date", () => {
    it("says nothing rather than 'NaN days ago'", () => {
      freezeClock();

      expect(fmtRelative("not-a-date")).toBe("-");
      expect(fmtRelative(new Date("nonsense"))).toBe("-");
    });
  });

  describe("when it is ahead of this browser's clock", () => {
    it("reads as just now rather than as a negative count", () => {
      freezeClock();

      expect(fmtRelative(at(-30_000))).toBe("0 seconds ago");
    });
  });
});

// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The break-glass dates, in the reader's timezone rather than in UTC.
 *
 * Spec: specs/identity/sso-activation.feature
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { endOfLocalDay, localIsoDateInDays } from "../break-glass-dates.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("given a date picked in the grant control", () => {
  describe("when it is turned into the instant the grant ends", () => {
    it("ends the day the reader picked, not the UTC day of the same name", () => {
      const ends = new Date(endOfLocalDay("2026-10-16"));

      // The regression: `2026-10-16T23:59:59.999Z` renders as the 17th
      // anywhere east of UTC, so the grants table said a day later than the
      // picker directly above it. Read back the way the table reads it, the
      // day has to be the day that was picked — wherever this runs.
      expect(ends.getFullYear()).toBe(2026);
      expect(ends.getMonth()).toBe(9);
      expect(ends.getDate()).toBe(16);
      // And it is the END of it, so a grant is usable all day.
      expect(ends.getHours()).toBe(23);
      expect(ends.getMinutes()).toBe(59);
    });

    it("refuses a date it cannot read rather than inventing one", () => {
      // NaN reaches the server as an invalid expiry and is refused there;
      // a silently-coerced epoch would be a grant that had already expired.
      expect(endOfLocalDay("")).toBeNaN();
      expect(endOfLocalDay("not-a-date")).toBeNaN();
      expect(endOfLocalDay("2026-13-01")).toBeNaN();
      expect(endOfLocalDay("2026-10")).toBeNaN();
    });
  });
});

describe("given the bounds the picker offers", () => {
  describe("when the reader's evening is already the next day in UTC", () => {
    it("counts from the day the reader is having", () => {
      // 23:30 on the 16th in a timezone two hours ahead is 21:30 UTC — still
      // the 16th — but an hour later `toISOString()` would say the 17th and
      // the picker's own minimum would skip a day.
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 9, 16, 23, 30, 0));

      expect(localIsoDateInDays(0)).toBe("2026-10-16");
      expect(localIsoDateInDays(1)).toBe("2026-10-17");
    });

    it("rolls the month and the year the way a calendar does", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 11, 31, 12, 0, 0));

      expect(localIsoDateInDays(1)).toBe("2027-01-01");
    });

    it("pads a single-digit month and day, so the input can hold it", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 0, 5, 12, 0, 0));

      expect(localIsoDateInDays(0)).toBe("2026-01-05");
    });
  });
});

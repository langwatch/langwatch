/**
 * @see specs/traces-v2/trace-table.feature
 */
import { describe, expect, it } from "vitest";

import { formatWallClock } from "../display-formatters.ts";

describe("formatWallClock", () => {
  describe("given a conversation that started at 10:00 and whose last trace ended at 10:08:12", () => {
    /** @scenario Wall-clock duration shows elapsed real time */
    it("reads the elapsed real time as wall: 8m 12s", () => {
      const start = Date.UTC(2026, 5, 2, 10, 0, 0);
      const end = Date.UTC(2026, 5, 2, 10, 8, 12);

      expect(formatWallClock(start, end)).toBe("wall: 8m 12s");
    });
  });

  describe("given a conversation shorter than a minute", () => {
    it("reads the seconds alone", () => {
      const start = Date.UTC(2026, 5, 2, 10, 0, 0);

      expect(formatWallClock(start, start + 42_000)).toBe("wall: 42s");
    });
  });
});

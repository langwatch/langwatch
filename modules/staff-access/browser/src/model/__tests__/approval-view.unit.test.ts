/**
 * The approval page's countdown text.
 * @see modules/staff-access/specs/staff-access-pages.feature
 */
import { describe, expect, it } from "vitest";

import { formatCountdown } from "../approval-view.ts";

const ms = ({ h = 0, m = 0, s = 0 }: { h?: number; m?: number; s?: number }): number =>
  ((h * 60 + m) * 60 + s) * 1000;

describe("formatCountdown", () => {
  /** @scenario "The approval countdown reads in hours and minutes" */
  it("reads hours and minutes for a two hour request", () => {
    expect(formatCountdown(ms({ h: 1, m: 59, s: 44 }))).toBe("1 h 59 min");
  });

  it("drops the minutes on a whole hour", () => {
    expect(formatCountdown(ms({ h: 2 }))).toBe("2 h");
  });

  it("reads minutes and seconds under an hour", () => {
    expect(formatCountdown(ms({ m: 9, s: 41 }))).toBe("9 min 41 s");
    expect(formatCountdown(ms({ m: 5 }))).toBe("5 min");
  });

  it("reads seconds under a minute, rounding part of a second up", () => {
    expect(formatCountdown(ms({ s: 41 }) - 500)).toBe("41 s");
  });

  it("never goes negative", () => {
    expect(formatCountdown(-5_000)).toBe("0 s");
  });
});

/**
 * The number helpers every template widget carries keep a missing value as a gap: null stays
 * null through reading and arithmetic, and prints as a dash, never as 0 or $0.00.
 * @see modules/analytics/specs/dashboard-widget-gaps.feature
 */

import { describe, expect, it } from "vitest";

import { NUMBERS } from "../model/widget-code-parts.ts";

interface Helpers {
  num: (value: unknown) => number | null;
  add: (...values: unknown[]) => number | null;
  ratio: (part: unknown, whole: unknown) => number | null;
  usd: (value: unknown) => string;
  ms: (value: unknown) => string;
  pct: (value: unknown, digits?: number) => string;
  count: (value: unknown) => string;
}

// The stored snippet is what the frame runs; evaluating it is the test.
// oxlint-disable-next-line no-implied-eval
const helpers = new Function(
  `${NUMBERS}\nreturn { num, add, ratio, usd, ms, pct, count };`,
)() as Helpers;

describe("the template number helpers", () => {
  /** @scenario "Template number helpers keep a missing value as a gap" */
  it("read null, undefined, NaN and an empty string as null, and a real 0 as 0", () => {
    for (const missing of [null, undefined, Number.NaN, "", "n/a"]) {
      expect(helpers.num(missing)).toBeNull();
    }
    expect(helpers.num(0)).toBe(0);
    expect(helpers.num("3")).toBe(3);
  });

  /** @scenario "Template number helpers keep a missing value as a gap" */
  it("print a missing value as a dash in every format", () => {
    for (const format of [helpers.usd, helpers.ms, helpers.pct, helpers.count]) {
      expect(format(null)).toBe("–");
    }
    expect(helpers.usd(0)).toBe("$0.00");
    expect(helpers.usd("12.5")).toBe("$12.50");
  });

  /** @scenario "Template number helpers keep a missing value as a gap" */
  it("sum only known values, and give null when none is known", () => {
    expect(helpers.add(null, 2, undefined, 3)).toBe(5);
    expect(helpers.add(null, undefined)).toBeNull();
    expect(helpers.add(0, null)).toBe(0);
  });

  /** @scenario "Template number helpers keep a missing value as a gap" */
  it("give no share when the part is unknown or the whole is not above zero", () => {
    expect(helpers.ratio(1, 4)).toBe(0.25);
    expect(helpers.ratio(null, 4)).toBeNull();
    expect(helpers.ratio(1, 0)).toBeNull();
    expect(helpers.ratio(1, null)).toBeNull();
  });
});

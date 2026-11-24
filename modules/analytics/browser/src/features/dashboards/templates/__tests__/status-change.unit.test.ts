/**
 * The Flight Deck's Status tiles compare each figure with the period before; past tenfold the
 * exact rise says nothing more, so the label reads "more than 10 times".
 */

import { describe, expect, it } from "vitest";

import { PAST_TENFOLD, STATUS_CODE } from "../model/flight-deck-chart-widgets.ts";

// oxlint-disable-next-line no-implied-eval
const pastTenfold = new Function(`${PAST_TENFOLD}\nreturn pastTenfold;`)() as (
  current: number,
  previous: number,
) => boolean;

describe("given the Status tiles", () => {
  /** @scenario "AC3c A status tile caps a change past tenfold" */
  it("caps only a rise past tenfold, not one of exactly tenfold", () => {
    expect(pastTenfold(1000, 100)).toBe(false);
    expect(pastTenfold(1001, 100)).toBe(true);
    expect(pastTenfold(1050, 100)).toBe(true);
    expect(pastTenfold(120, 100)).toBe(false);
    expect(pastTenfold(5, 100)).toBe(false);
  });

  /** @scenario "AC3c A status tile caps a change past tenfold" */
  it("says more than 10 times past tenfold and keeps a signed percentage below it", () => {
    expect(STATUS_CODE.tsx).toContain(PAST_TENFOLD);
    expect(STATUS_CODE.tsx).toContain("if (pastTenfold(current, previous)) {");
    expect(STATUS_CODE.tsx).toContain("more than 10 times the previous period");
    expect(STATUS_CODE.tsx).toContain('(delta > 0 ? "+" : "") + (delta * 100).toFixed(0) + "%"');
  });
});

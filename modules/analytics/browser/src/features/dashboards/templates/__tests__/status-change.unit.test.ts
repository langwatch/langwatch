/**
 * The Flight Deck's Status tiles compare each figure with the period before; past tenfold the
 * exact rise says nothing more, so the label reads "more than 10 times".
 */

import { describe, expect, it } from "vitest";

import { STATUS_CODE } from "../model/flight-deck-chart-widgets.ts";

describe("given the Status tiles", () => {
  /** @scenario "AC3c A status tile caps a change past tenfold" */
  it("says more than 10 times past tenfold and keeps a signed percentage below it", () => {
    expect(STATUS_CODE.tsx).toContain("if (Math.abs(delta) > 9.99) {");
    expect(STATUS_CODE.tsx).toContain("more than 10 times the previous period");
    expect(STATUS_CODE.tsx).toContain('(delta > 0 ? "+" : "") + (delta * 100).toFixed(0) + "%"');
  });
});

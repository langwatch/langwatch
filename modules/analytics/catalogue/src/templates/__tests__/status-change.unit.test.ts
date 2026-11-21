/**
 * The Flight Deck's Status tiles compare each figure with the period before; past tenfold the
 * exact rise says nothing more, so the label is capped as on the legacy summary tiles.
 */

import { describe, expect, it } from "vitest";

import { STATUS_CODE } from "../model/flight-deck-chart-widgets.ts";

describe("given the Status tiles", () => {
  /** @scenario "AC3c A status tile caps a change past tenfold" */
  it("labels a change past tenfold 999%+ and keeps a signed percentage below it", () => {
    expect(STATUS_CODE.tsx).toContain('Math.abs(delta) > 9.99\n    ? "999%+"');
    expect(STATUS_CODE.tsx).toContain('(delta > 0 ? "+" : "") + (delta * 100).toFixed(0) + "%"');
  });
});

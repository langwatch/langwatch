/**
 * A routed judged query's cost ceiling (ADR-190 decision 13).
 * @see specs/lwql/eval-functions.feature
 */
import { describe, expect, it } from "vitest";

import { InstantEvalQueryCostCeilingService } from "../instant-eval-query-cost-ceiling.service.ts";

describe("InstantEvalQueryCostCeilingService", () => {
  /** @scenario "A routed query's ceiling holds sends up to the ceiling and no further" */
  it("holds sends while billed plus held stays within the ceiling, and refuses the one past it", () => {
    const ceiling = InstantEvalQueryCostCeilingService.create({ ceilingNanoUsd: 100 });

    expect(ceiling.hold(60)).toBe(true);
    expect(ceiling.hold(40)).toBe(true);
    expect(ceiling.hold(1)).toBe(false);
  });

  /** @scenario "A routed query's ceiling holds sends up to the ceiling and no further" */
  it("frees a settled hold and counts what the send billed in its place", () => {
    const ceiling = InstantEvalQueryCostCeilingService.create({ ceilingNanoUsd: 100 });
    ceiling.hold(60);
    ceiling.settle({ heldNanoUsd: 60, costNanoUsd: 10 });

    expect(ceiling.hold(90)).toBe(true);
    expect(ceiling.hold(1)).toBe(false);
  });

  /** @scenario "A routed query's ceiling holds sends up to the ceiling and no further" */
  it("holds nothing for a refused send", () => {
    const ceiling = InstantEvalQueryCostCeilingService.create({ ceilingNanoUsd: 100 });

    expect(ceiling.hold(101)).toBe(false);
    expect(ceiling.hold(100)).toBe(true);
  });

  /** @scenario "A routed query's ceiling holds sends up to the ceiling and no further" */
  it("never holds a worst case that is not a finite cost", () => {
    const ceiling = InstantEvalQueryCostCeilingService.create({ ceilingNanoUsd: 100 });

    expect(ceiling.hold(Number.POSITIVE_INFINITY)).toBe(false);
    expect(ceiling.hold(Number.NaN)).toBe(false);
    expect(ceiling.hold(-1)).toBe(false);
    expect(ceiling.hold(100)).toBe(true);
  });
});

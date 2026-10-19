/**
 * @vitest-environment node
 * The newest usage-billing fact wins, and a real fact wins a tie (ADR-174 decision 17).
 */
import { describe, expect, it } from "vitest";

import { usageBillingFactWins } from "../instant-eval-judge-usage-billing.rules.ts";

const real = (occurredAtMs: number, usageBilled = true) => ({
  usageBilled,
  occurredAtMs,
  fromCatchUp: false,
});
const catchUp = (occurredAtMs: number, usageBilled = true) => ({
  usageBilled,
  occurredAtMs,
  fromCatchUp: true,
});

describe("usageBillingFactWins", () => {
  it("keeps the first fact the judge folds", () => {
    expect(usageBillingFactWins({ held: null, incoming: catchUp(10) })).toBe(true);
  });

  it("keeps a newer fact over an older one, whichever kind each is", () => {
    expect(usageBillingFactWins({ held: real(10), incoming: catchUp(20) })).toBe(true);
    expect(usageBillingFactWins({ held: catchUp(10), incoming: real(20) })).toBe(true);
  });

  it("drops an older fact, whichever kind each is", () => {
    expect(usageBillingFactWins({ held: real(20), incoming: catchUp(10) })).toBe(false);
    expect(usageBillingFactWins({ held: catchUp(20), incoming: real(10) })).toBe(false);
  });

  it("gives a tie to a real fact over a catch-up", () => {
    expect(usageBillingFactWins({ held: catchUp(10), incoming: real(10, false) })).toBe(true);
    expect(usageBillingFactWins({ held: real(10, false), incoming: catchUp(10) })).toBe(false);
  });

  it("keeps the held fact on a tie between two of the same kind", () => {
    expect(usageBillingFactWins({ held: real(10), incoming: real(10, false) })).toBe(false);
    expect(usageBillingFactWins({ held: catchUp(10), incoming: catchUp(10, false) })).toBe(false);
  });
});

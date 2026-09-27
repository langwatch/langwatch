import { describe, expect, it } from "vitest";

import { spendSettlementStateSchema } from "../gateway-spend-settlement.process.ts";

describe("process state stored by the main release", () => {
  it("parses a spend settlement state as main stored it", () => {
    expect(spendSettlementStateSchema.parse({ lastSweepAt: 1 })).toEqual({ lastSweepAt: 1 });
  });
  it("reads a first-release per-request settlement state as never swept", () => {
    expect(
      spendSettlementStateSchema.parse({ admittedAtMs: 1, resolved: false, settleIssued: false }),
    ).toEqual({ lastSweepAt: null });
  });
});

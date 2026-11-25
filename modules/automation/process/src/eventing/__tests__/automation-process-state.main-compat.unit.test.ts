import { describe, expect, it } from "vitest";

import { triggerSettlementStateSchema } from "../../rules/trigger-settlement-state.rules.ts";
import { graphAlertSweepStateSchema } from "../graph-alert-sweep.process.ts";

describe("process state stored by the main release", () => {
  it("parses a graph alert sweep state as main stored it", () => {
    expect(graphAlertSweepStateSchema.parse({ lastSweepAt: null })).toEqual({ lastSweepAt: null });
  });
  it("parses a trigger settlement state as main stored it", () => {
    expect(
      triggerSettlementStateSchema.parse({
        pendingMatches: {
          m1: { settleDueAt: 1, dispatchDueAt: 2, actionClass: "notify", settleWindowBucket: "b1" },
        },
        overflowFlushed: 0,
      }),
    ).toEqual({
      pendingMatches: {
        m1: { settleDueAt: 1, dispatchDueAt: 2, actionClass: "notify", settleWindowBucket: "b1" },
      },
      overflowFlushed: 0,
    });
  });
});

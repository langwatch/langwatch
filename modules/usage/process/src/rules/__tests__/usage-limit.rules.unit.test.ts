import type { MonthCountedEventData } from "@langwatch/usage-contract";
import { describe, expect, it } from "vitest";

import { decideLimit } from "../usage-limit.rules.ts";

const counted = (
  billableEvents: number,
  allowance = 1_000,
  month = "2026-10",
): MonthCountedEventData => ({
  organizationId: "org_1",
  month,
  occurredAt: 1,
  billableEvents,
  limit: { allowance, planName: "Launch", unit: "events" },
});

describe("decideLimit", () => {
  it("Crossing the allowance records the limit as reached", () => {
    const result = decideLimit({ state: { month: null, reached: false }, counted: counted(1_000) });
    expect(result.decision).toBe("reached");
  });

  it("Counting again past the allowance records nothing new", () => {
    const result = decideLimit({
      state: { month: "2026-10", reached: true },
      counted: counted(1_200),
    });
    expect(result.decision).toBe("none");
  });

  it("An upgrade clears a reached limit", () => {
    const result = decideLimit({
      state: { month: "2026-10", reached: true },
      counted: counted(1_200, 10_000),
    });
    expect(result).toEqual({ state: { month: "2026-10", reached: false }, decision: "cleared" });
  });

  it("a late recount of last month changes nothing", () => {
    const result = decideLimit({
      state: { month: "2026-10", reached: true },
      counted: counted(0, 1_000, "2026-09"),
    });
    expect(result.decision).toBe("none");
  });
});

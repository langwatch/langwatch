import { describe, expect, it } from "vitest";

import { gatewayDebitsStateSchema } from "../gateway-debit.process.ts";
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
  it("parses a gateway debits state as main stored it", () => {
    const stored = {
      endUserId: "",
      virtualKeyId: "vk_1",
      organizationId: "org_1",
      teamId: "team_1",
      principalUserId: "user_1",
      admitted: true,
      pendingOutcome: null,
    };
    expect(gatewayDebitsStateSchema.parse(stored)).toEqual(stored);
  });
});

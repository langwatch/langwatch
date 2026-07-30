import { checkTypeStringRatchet } from "@langwatch/event-sourcing";
import { describe, expect, it, vi } from "vitest";
import {
  BILLING_REPORTING_TYPE_STRING_SNAPSHOT,
  checkBillingReportingRatchet,
  currentBillingReportingTypeStrings,
} from "../ratchet";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

describe("the billing-reporting type-string ratchet (ADR-105 decision 10)", () => {
  /** @scenario The pipeline's persisted event and intent type strings are ratcheted */
  it("passes against the committed snapshot right now", () => {
    expect(checkBillingReportingRatchet()).toEqual([]);
  });

  it("commits every type string every declaration currently produces", () => {
    expect(BILLING_REPORTING_TYPE_STRING_SNAPSHOT).toEqual(currentBillingReportingTypeStrings());
  });

  it("would fail if a committed intent type went missing — proving the check actually checks something", () => {
    const violations = checkTypeStringRatchet({
      snapshot: { billingMeterPoke: ["billingMeterPoke/reportUsage", "billingMeterPoke/aTypeThatUsedToExist"] },
      current: currentBillingReportingTypeStrings(),
    });
    expect(violations).toEqual([{ declaration: "billingMeterPoke", missing: ["billingMeterPoke/aTypeThatUsedToExist"] }]);
  });
});

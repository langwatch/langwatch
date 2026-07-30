import { checkTypeStringRatchet } from "@langwatch/event-sourcing";
import { describe, expect, it, vi } from "vitest";
import { AUTOMATIONS_TYPE_STRING_SNAPSHOT, checkAutomationsRatchet, currentAutomationsTypeStrings } from "../ratchet";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

describe("the automations type-string ratchet (ADR-105 decision 10)", () => {
  /** @scenario The pipeline's persisted event and intent type strings are ratcheted */
  it("passes against the committed snapshot right now", () => {
    expect(checkAutomationsRatchet()).toEqual([]);
  });

  it("commits every type string every declaration currently produces", () => {
    expect(AUTOMATIONS_TYPE_STRING_SNAPSHOT).toEqual(currentAutomationsTypeStrings());
  });

  it("would fail if a committed intent type went missing — proving the check actually checks something", () => {
    const violations = checkTypeStringRatchet({
      snapshot: {
        triggerSettlement: ["triggerSettlement/notifyDigest", "triggerSettlement/aTypeThatUsedToExist"],
      },
      current: currentAutomationsTypeStrings(),
    });
    expect(violations).toEqual([
      { declaration: "triggerSettlement", missing: ["triggerSettlement/aTypeThatUsedToExist"] },
    ]);
  });
});

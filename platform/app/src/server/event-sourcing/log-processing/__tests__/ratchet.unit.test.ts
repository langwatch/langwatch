import { checkTypeStringRatchet } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import { logRecord } from "../aggregate";
import {
  checkLogProcessingRatchet,
  LOG_PROCESSING_TYPE_STRING_SNAPSHOT,
} from "../ratchet";

describe("the log-processing type-string ratchet (ADR-105 §3)", () => {
  /** @scenario The aggregate's persisted event-type strings are ratcheted */
  it("passes against the committed snapshot right now", () => {
    expect(checkLogProcessingRatchet()).toEqual([]);
  });

  it("commits every type string the aggregate currently declares", () => {
    expect(LOG_PROCESSING_TYPE_STRING_SNAPSHOT.log).toEqual([
      ...logRecord.eventTypes,
    ]);
  });

  it("would fail if a committed string went missing — proving the check actually checks something", () => {
    const violations = checkTypeStringRatchet({
      snapshot: { log: ["log/recordReceived", "log/aTypeThatUsedToExist"] },
      current: { log: [...logRecord.eventTypes] },
    });
    expect(violations).toEqual([
      { aggregate: "log", missing: ["log/aTypeThatUsedToExist"] },
    ]);
  });
});

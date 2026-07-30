import { checkTypeStringRatchet } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import {
  checkLogProcessingRatchet,
  currentLogProcessingTypeStrings,
  LOG_PROCESSING_TYPE_STRING_SNAPSHOT,
} from "../ratchet";

describe("the log-processing type-string ratchet (ADR-105 decision 10)", () => {
  /** @scenario The aggregate's persisted event-type strings are ratcheted */
  it("passes against the committed snapshot right now", () => {
    expect(checkLogProcessingRatchet()).toEqual([]);
  });

  it("commits every type string the pipeline currently declares", () => {
    expect(LOG_PROCESSING_TYPE_STRING_SNAPSHOT.log).toEqual(
      currentLogProcessingTypeStrings().log,
    );
  });

  it("would fail if a committed string went missing — proving the check actually checks something", () => {
    const violations = checkTypeStringRatchet({
      snapshot: {
        log: [
          "lw.obs.log.record_received",
          "lw.obs.log.a_type_that_used_to_exist",
        ],
      },
      current: currentLogProcessingTypeStrings(),
    });
    expect(violations).toEqual([
      { declaration: "log", missing: ["lw.obs.log.a_type_that_used_to_exist"] },
    ]);
  });
});

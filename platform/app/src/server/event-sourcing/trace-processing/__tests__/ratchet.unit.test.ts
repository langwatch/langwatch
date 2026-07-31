import { checkTypeStringRatchet } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import {
  checkTraceProcessingRatchet,
  currentTraceProcessingTypeStrings,
  TRACE_PROCESSING_TYPE_STRING_SNAPSHOT,
} from "../ratchet";

describe("the trace-processing type-string ratchet (ADR-105 decision 10)", () => {
  it("passes against the committed snapshot right now", () => {
    expect(checkTraceProcessingRatchet()).toEqual([]);
  });

  it("commits every type string the pipeline currently declares", () => {
    expect(TRACE_PROCESSING_TYPE_STRING_SNAPSHOT.trace).toEqual(
      currentTraceProcessingTypeStrings().trace,
    );
  });

  it("would fail if a committed string went missing — proving the check actually checks something", () => {
    const violations = checkTypeStringRatchet({
      snapshot: {
        trace: [
          "lw.obs.trace.span_received",
          "lw.obs.trace.a_type_that_used_to_exist",
        ],
      },
      current: currentTraceProcessingTypeStrings(),
    });
    expect(violations).toEqual([
      {
        declaration: "trace",
        missing: ["lw.obs.trace.a_type_that_used_to_exist"],
      },
    ]);
  });
});

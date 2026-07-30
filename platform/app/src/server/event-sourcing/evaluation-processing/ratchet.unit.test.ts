import { checkTypeStringRatchet } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import {
    checkEvaluationProcessingRatchet,
    currentEvaluationProcessingTypeStrings,
    EVALUATION_PROCESSING_TYPE_STRING_SNAPSHOT,
} from "./ratchet";

describe("the evaluation-processing type-string ratchet (ADR-105 decision 10)", () => {
  /**
   * @scenario "The event type strings are ratcheted against the committed snapshot"
   */
  it("passes against the committed snapshot right now", () => {
    expect(checkEvaluationProcessingRatchet()).toEqual([]);
  });

  it("commits every type string the pipeline currently declares", () => {
    expect(EVALUATION_PROCESSING_TYPE_STRING_SNAPSHOT.evaluation).toEqual(
      currentEvaluationProcessingTypeStrings().evaluation,
    );
  });

  it("would fail if a committed string went missing — proving the check actually checks something", () => {
    const violations = checkTypeStringRatchet({
      snapshot: {
        evaluation: ["lw.evaluation.started", "lw.evaluation.a_type_that_used_to_exist"],
      },
      current: currentEvaluationProcessingTypeStrings(),
    });
    expect(violations).toEqual([
      {
        declaration: "evaluation",
        missing: ["lw.evaluation.a_type_that_used_to_exist"],
      },
    ]);
  });
});

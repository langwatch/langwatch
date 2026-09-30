import { describe, expect, it } from "vitest";

import {
  engineForEvaluator,
  handledCodeForRuntimeRefusal,
  isSameVerdict,
} from "../evaluator-runtime-engine.rules.ts";

const evaluatorType = "langevals/exact_match";

describe("engineForEvaluator", () => {
  it("runs an evaluator on its own override", () => {
    expect(
      engineForEvaluator({
        evaluatorType,
        engine: "python",
        engineOverrides: { [evaluatorType]: "go" },
      }),
    ).toBe("go");
  });

  it("runs every other evaluator on the default engine", () => {
    expect(
      engineForEvaluator({
        evaluatorType: "ragas/faithfulness",
        engine: "shadow",
        engineOverrides: { [evaluatorType]: "go" },
      }),
    ).toBe("shadow");
  });
});

describe("handledCodeForRuntimeRefusal", () => {
  it.each([
    ["evaluator_not_found", "evaluator_not_found"],
    ["evaluator_settings_invalid", "evaluator_config_error"],
    ["evaluation_payload_too_large", "evaluator_input_too_large"],
    ["evaluation_busy", "evaluation_busy"],
    ["unauthorized", "evaluator_execution_error"],
    ["tenant_missing", "evaluator_execution_error"],
    [undefined, "evaluator_execution_error"],
  ])("maps %s to %s", (code, expected) => {
    expect(handledCodeForRuntimeRefusal({ code })).toBe(expected);
  });
});

describe("isSameVerdict", () => {
  it("agrees on equal scores and verdicts", () => {
    expect(
      isSameVerdict({
        python: { status: "processed", score: 1, passed: true },
        go: { status: "processed", score: 1, passed: true },
      }),
    ).toBe(true);
  });

  it("disagrees on a different score", () => {
    expect(
      isSameVerdict({
        python: { status: "processed", score: 1 },
        go: { status: "processed", score: 0.5 },
      }),
    ).toBe(false);
  });

  it("compares statuses when either did not process", () => {
    expect(
      isSameVerdict({
        python: { status: "skipped", details: "no input" },
        go: { status: "processed", score: 1 },
      }),
    ).toBe(false);
  });
});

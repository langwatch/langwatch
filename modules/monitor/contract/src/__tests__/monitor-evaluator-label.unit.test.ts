/**
 * Spec: modules/evaluator/specs/evaluator-versioning.feature
 */
import { describe, expect, it } from "vitest";

import { monitorEvaluatorLabelSchema } from "../monitor.ts";

describe("a monitor's evaluator label", () => {
  /** @scenario "A monitor refuses a label name the evaluator label rules refuse" */
  it("takes a label name and refuses latest, a number or a malformed name", () => {
    expect(monitorEvaluatorLabelSchema.parse("production")).toBe("production");
    for (const name of ["latest", "2", "Prod", ""]) {
      expect(monitorEvaluatorLabelSchema.validate(name)).toBe(false);
    }
  });
});

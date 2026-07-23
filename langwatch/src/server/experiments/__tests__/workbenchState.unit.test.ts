import { describe, expect, it } from "vitest";

import { isLegacyOnlineEvaluationWorkbenchState } from "../workbenchState";

describe("isLegacyOnlineEvaluationWorkbenchState", () => {
  it("identifies real-time wizard experiments as online evaluation backing data", () => {
    expect(
      isLegacyOnlineEvaluationWorkbenchState({ task: "real_time" }),
    ).toBe(true);
  });

  it("keeps offline experiment tasks in the experiments workflow", () => {
    expect(isLegacyOnlineEvaluationWorkbenchState({ task: "llm_app" })).toBe(
      false,
    );
    expect(isLegacyOnlineEvaluationWorkbenchState(null)).toBe(false);
    expect(isLegacyOnlineEvaluationWorkbenchState([])).toBe(false);
  });
});

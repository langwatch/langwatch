import { LANGWATCH_DECISION_MODEL_ID } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import {
  decisionModelPickerOptions,
  ROUTED_HOSTED_DECISION_MODEL_SUBTITLE,
} from "../decision-model-options.ts";

describe("decisionModelPickerOptions", () => {
  const hostedSubtitle = (isJudgeRouted: boolean) =>
    decisionModelPickerOptions({ pickable: [], isJudgeRouted }).find(
      (option) => option.value === LANGWATCH_DECISION_MODEL_ID,
    )?.subtitle;

  /** @scenario "With the router flag on LangWatch Instant Preview says it routes" */
  it("says LangWatch Instant Preview routes when the judge router flag is on", () => {
    expect(hostedSubtitle(true)).toBe(ROUTED_HOSTED_DECISION_MODEL_SUBTITLE);
  });

  it("keeps the hosted line when the judge router flag is off", () => {
    expect(hostedSubtitle(false)).toBe("Hosted by LangWatch and billed with your plan.");
  });
});

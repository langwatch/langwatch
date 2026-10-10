import { describe, expect, it } from "vitest";

import { AVAILABLE_EVALUATORS, evaluatorsSchema } from "../index.ts";

const scoreSettingsSchema = evaluatorsSchema.shape["langevals/llm_score"].shape.settings;

describe("given the generated settings of the score judge", () => {
  /** @scenario "The score judge's settings carry an optional range" */
  it("holds an optional min and max, neither with a default", () => {
    const withRange = scoreSettingsSchema.parse({ prompt: "rate it", min: 1, max: 5 });
    expect(withRange.min).toBe(1);
    expect(withRange.max).toBe(5);

    const withoutRange = scoreSettingsSchema.parse({ prompt: "rate it" });
    expect(withoutRange.min).toBeUndefined();
    expect(withoutRange.max).toBeUndefined();

    const catalogue = AVAILABLE_EVALUATORS["langevals/llm_score"]?.settings;
    expect(catalogue).toHaveProperty("min");
    expect(catalogue).toHaveProperty("max");
    expect(catalogue?.min?.default).toBeUndefined();
    expect(catalogue?.max?.default).toBeUndefined();
  });
});

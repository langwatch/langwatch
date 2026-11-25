import { describe, expect, it } from "vitest";

import { FEATURE_FLAGS } from "../feature-flag.ts";

describe("the Instant Evals own decision model flag", () => {
  /** @scenario "Own decision models are on by default" */
  it("is a product flag, on unless switched off", () => {
    const flag = FEATURE_FLAGS.find((f) => f.key === "release_instant_evals_own_decision_model");
    expect(flag).toMatchObject({ scope: "PRODUCT", defaultValue: true });
  });
});

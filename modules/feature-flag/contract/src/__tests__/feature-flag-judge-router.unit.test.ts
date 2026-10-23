import { describe, expect, it } from "vitest";

import { FEATURE_FLAGS } from "../feature-flag.ts";

describe("the Instant Evals judge router flag", () => {
  /** @scenario "The router flag is off by default" */
  it("is a product flag, off unless a targeting rule turns it on", () => {
    const flag = FEATURE_FLAGS.find((f) => f.key === "release_instant_evals_judge_router");
    expect(flag).toMatchObject({ scope: "PRODUCT", defaultValue: false });
  });
});

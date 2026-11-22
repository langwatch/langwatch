import { describe, expect, it } from "vitest";

import { FEATURE_FLAGS } from "../feature-flag.ts";

describe("the Instant Evals hosted switch", () => {
  /** @scenario "The hosted switch is off unless set for an organization" */
  it("is a product flag, off by default", () => {
    const flag = FEATURE_FLAGS.find((f) => f.key === "instant_evals_hosted_disabled");
    expect(flag).toMatchObject({ scope: "PRODUCT", defaultValue: false });
  });
});

import { describe, expect, it } from "vitest";

import { FEATURE_FLAGS } from "../feature-flag.ts";

describe("the Instant Evals judge router flag", () => {
  const flag = FEATURE_FLAGS.find((f) => f.key === "release_instant_evals_judge_router");

  /** @scenario "The router flag is on by default on LangWatch Cloud" */
  it("is a product flag, on unless a targeting rule turns it off", () => {
    expect(flag).toMatchObject({ scope: "PRODUCT", defaultValue: true });
  });

  /** @scenario "The router flag is off by default on a self-hosted install" */
  it("is off by default on a self-hosted install", () => {
    expect(flag).toMatchObject({ selfHostedDefaultValue: false });
  });
});

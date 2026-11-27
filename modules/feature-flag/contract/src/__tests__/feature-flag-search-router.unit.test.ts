import { describe, expect, it } from "vitest";

import { FEATURE_FLAGS } from "../feature-flag.ts";

describe("the Instant Evals search router flag", () => {
  const flag = FEATURE_FLAGS.find((f) => f.key === "release_instant_evals_search_router");

  /** @scenario "Routed search has its own rollout flag, off everywhere by default" */
  it("is a product flag, off on LangWatch Cloud until a targeting rule turns it on", () => {
    expect(flag).toMatchObject({ scope: "PRODUCT", defaultValue: false });
  });

  /** @scenario "Routed search has its own rollout flag, off everywhere by default" */
  it("is off by default on a self-hosted install", () => {
    expect(flag).toMatchObject({ selfHostedDefaultValue: false });
  });
});

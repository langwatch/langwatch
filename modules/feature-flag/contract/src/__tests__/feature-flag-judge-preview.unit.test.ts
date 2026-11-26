import { describe, expect, it } from "vitest";

import { FEATURE_FLAGS } from "../feature-flag.ts";
import { FRONTEND_FEATURE_FLAGS } from "../frontend-feature-flags.ts";

describe("the LangWatch Judge (preview) flag", () => {
  const flag = FEATURE_FLAGS.find((f) => f.key === "release_langwatch_judge_preview");

  /** @scenario "The judge preview flag is off by default, on Cloud and self-hosted" */
  it("is a product flag, off until a targeting rule turns it on", () => {
    expect(flag).toMatchObject({ scope: "PRODUCT", defaultValue: false });
  });

  /** @scenario "The judge preview flag is off by default, on Cloud and self-hosted" */
  it("is off by default on a self-hosted install", () => {
    expect(flag).toMatchObject({ selfHostedDefaultValue: false });
  });

  it("is read by the browser, so the pickers can offer the model", () => {
    expect(FRONTEND_FEATURE_FLAGS).toContain("release_langwatch_judge_preview");
  });
});

import { describe, expect, it } from "vitest";
import { buildProviderOnboardingDefaultPlan } from "../onboarding-defaults";

describe("provider onboarding default plans", () => {
  /** @scenario "OpenAI seed plan uses latest aliases" */
  /** @scenario "Anthropic seed plan uses latest aliases" */
  /** @scenario "Anthropic seed plan omits EMBEDDINGS" */
  /** @scenario "Gemini seed plan uses latest aliases" */
  it("uses movable aliases for OpenAI, Anthropic, and Gemini", () => {
    expect(buildProviderOnboardingDefaultPlan("openai")).toMatchObject({
      DEFAULT: "openai/latest",
      FAST: "openai/latest-mini",
      EMBEDDINGS: expect.stringMatching(/^openai\/text-embedding-/),
    });
    expect(buildProviderOnboardingDefaultPlan("anthropic")).toEqual({
      DEFAULT: "anthropic/latest",
      FAST: "anthropic/latest-mini",
    });
    expect(buildProviderOnboardingDefaultPlan("gemini")).toMatchObject({
      DEFAULT: "gemini/latest",
      FAST: "gemini/latest-mini",
      EMBEDDINGS: expect.stringMatching(/^gemini\/gemini-embedding-/),
    });
  });

  /** @scenario "Voyage seed plan populates only EMBEDDINGS" */
  it("only seeds embeddings for Voyage and makes no guess for unknown providers", () => {
    expect(buildProviderOnboardingDefaultPlan("voyage")).toEqual({
      EMBEDDINGS: "voyage/voyage-3.5",
    });
    expect(buildProviderOnboardingDefaultPlan("unknown")).toEqual({});
  });
});

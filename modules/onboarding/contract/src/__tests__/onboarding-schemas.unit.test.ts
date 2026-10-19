import { describe, expect, it } from "vitest";

import { GUIDED_PATHS, GUIDED_PATH_TITLES } from "../onboarding-guided-paths.ts";
import { parseGuidedOnboardingState, signUpDataSchema } from "../onboarding-schemas.ts";

describe("guided path enum", () => {
  /** @scenario "the guided path enum carries the four paths with their titles" */
  it("carries the four paths with their titles", () => {
    expect(GUIDED_PATHS).toEqual(["llmops", "coding", "gateway", "governance"]);
    expect(GUIDED_PATH_TITLES).toEqual({
      llmops: "Evals & LLM Ops",
      coding: "Coding Agent Tracking",
      gateway: "Gateway",
      governance: "Governance",
    });
  });
});

describe("signUpDataSchema", () => {
  /** @scenario "the sign-up data schema accepts the onboarding variant and the guided state" */
  it("accepts an onboarding variant and a guided onboarding block, keeping paths in order", () => {
    const parsed = signUpDataSchema.parse({
      onboardingVariant: "guided",
      guidedOnboarding: {
        paths: ["gateway", "llmops"],
        currentPath: "gateway",
        donePaths: [],
      },
    });

    expect(parsed.onboardingVariant).toBe("guided");
    expect(parsed.guidedOnboarding?.paths).toEqual(["gateway", "llmops"]);
  });
});

describe("parseGuidedOnboardingState", () => {
  /** @scenario "a malformed guided state on the organization reads as the empty default" */
  it("returns the empty default when the stored shape does not match", () => {
    const state = parseGuidedOnboardingState({ guidedOnboarding: "not-an-object" });

    expect(state).toEqual({ paths: [], donePaths: [] });
  });

  it("returns the empty default when there is no sign-up data at all", () => {
    expect(parseGuidedOnboardingState(undefined)).toEqual({ paths: [], donePaths: [] });
  });
});

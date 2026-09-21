import { describe, expect, it } from "vitest";

import {
  ONBOARDING_EXPERIMENT_PROPERTY,
  experimentVariantFor,
  onboardingExperimentProperties,
} from "../onboarding-experiment.ts";

describe("experimentVariantFor", () => {
  it("maps guided to the PostHog guided variant and classic to control", () => {
    expect(experimentVariantFor("guided")).toBe("guided");
    expect(experimentVariantFor("classic")).toBe("control");
  });
});

describe("onboardingExperimentProperties", () => {
  it("spreads the PostHog property only when a variant is recorded", () => {
    expect(onboardingExperimentProperties("guided")).toEqual({
      [ONBOARDING_EXPERIMENT_PROPERTY]: "guided",
    });
    expect(onboardingExperimentProperties(null)).toEqual({});
  });
});

/**
 * @vitest-environment node
 *
 * The mapping from the organization's onboarding variant to the PostHog
 * experiment property: the classic onboarding is the baseline, named
 * control, and an organization without a variant gets no property.
 *
 * @see specs/analytics/posthog-guided-onboarding.feature
 */
import { describe, expect, it } from "vitest";
import {
  ONBOARDING_EXPERIMENT_PROPERTY,
  onboardingExperimentProperties,
  onboardingExperimentVariant,
} from "../guided-onboarding.experiment";

describe("onboardingExperimentProperties()", () => {
  describe("when the organization recorded a variant", () => {
    /** @scenario "the experiment property maps the guided variant to guided and the classic variant to control" */
    it("names the guided variant guided and the classic variant control under the flag property", () => {
      expect(ONBOARDING_EXPERIMENT_PROPERTY).toBe(
        "$feature/experiment_onboarding_langy_guided",
      );
      expect(onboardingExperimentProperties("guided")).toEqual({
        "$feature/experiment_onboarding_langy_guided": "guided",
      });
      expect(onboardingExperimentProperties("classic")).toEqual({
        "$feature/experiment_onboarding_langy_guided": "control",
      });
      expect(onboardingExperimentVariant("classic")).toBe("control");
    });
  });

  describe("when the organization recorded no variant", () => {
    it("returns no property", () => {
      expect(onboardingExperimentProperties(null)).toEqual({});
      expect(onboardingExperimentProperties(undefined)).toEqual({});
      expect(onboardingExperimentVariant(null)).toBeNull();
    });
  });
});

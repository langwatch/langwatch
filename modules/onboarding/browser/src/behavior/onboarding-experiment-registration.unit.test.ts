/**
 * @vitest-environment jsdom
 * A variant registers posthog-js's property, no variant clears it.
 * @see specs/analytics/posthog-guided-onboarding.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRegister, mockUnregister } = vi.hoisted(() => ({
  mockRegister: vi.fn(),
  mockUnregister: vi.fn(),
}));

vi.mock("posthog-js", () => ({
  default: { register: mockRegister, unregister: mockUnregister },
}));

import { registerOnboardingExperiment } from "./onboarding-experiment-registration.ts";

describe("registerOnboardingExperiment()", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("when the organization recorded a variant", () => {
    it("registers the property, control for the classic variant", () => {
      registerOnboardingExperiment("guided");
      registerOnboardingExperiment("classic");

      expect(mockRegister).toHaveBeenNthCalledWith(1, {
        "$feature/experiment_onboarding_langy_guided": "guided",
      });
      expect(mockRegister).toHaveBeenNthCalledWith(2, {
        "$feature/experiment_onboarding_langy_guided": "control",
      });
      expect(mockUnregister).not.toHaveBeenCalled();
    });
  });

  describe("when the organization recorded no variant", () => {
    /** @scenario "the registration clears the property for an organization without a variant" */
    it("unregisters the property instead of leaving a previous value", () => {
      registerOnboardingExperiment("guided");
      registerOnboardingExperiment(null);
      registerOnboardingExperiment(undefined);

      expect(mockUnregister).toHaveBeenCalledTimes(2);
      expect(mockUnregister).toHaveBeenCalledWith("$feature/experiment_onboarding_langy_guided");
    });
  });
});

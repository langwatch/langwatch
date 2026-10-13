/**
 * A variant registers the analytics super-property, no variant clears it.
 * @see specs/analytics/posthog-guided-onboarding.feature
 */
import { UiAnalytics } from "@langwatch/browser-host/analytics";
import { describe, expect, it, vi } from "vitest";

import { registerOnboardingExperiment } from "./onboarding-experiment-registration.ts";

class RecordingUiAnalytics extends UiAnalytics {
  track(): void {}
  identify(): void {}
  group(): void {}
  reset(): void {}
  override register = vi.fn();
  override unregister = vi.fn();
}

describe("registerOnboardingExperiment()", () => {
  describe("when the organization recorded a variant", () => {
    it("registers the property, control for the classic variant", () => {
      const analytics = new RecordingUiAnalytics();
      registerOnboardingExperiment({ analytics, variant: "guided" });
      registerOnboardingExperiment({ analytics, variant: "classic" });

      expect(analytics.register).toHaveBeenNthCalledWith(1, {
        "$feature/experiment_onboarding_langy_guided": "guided",
      });
      expect(analytics.register).toHaveBeenNthCalledWith(2, {
        "$feature/experiment_onboarding_langy_guided": "control",
      });
      expect(analytics.unregister).not.toHaveBeenCalled();
    });
  });

  describe("when the organization recorded no variant", () => {
    /** @scenario "the registration clears the property for an organization without a variant" */
    it("unregisters the property instead of leaving a previous value", () => {
      const analytics = new RecordingUiAnalytics();
      registerOnboardingExperiment({ analytics, variant: "guided" });
      registerOnboardingExperiment({ analytics, variant: null });
      registerOnboardingExperiment({ analytics, variant: undefined });

      expect(analytics.unregister).toHaveBeenCalledTimes(2);
      expect(analytics.unregister).toHaveBeenCalledWith(
        "$feature/experiment_onboarding_langy_guided",
      );
    });
  });
});

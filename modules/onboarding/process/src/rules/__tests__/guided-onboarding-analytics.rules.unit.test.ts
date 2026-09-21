/**
 * @scenario "guided event properties carry only the named payload fields"
 * @scenario "conversation attached and virtual key minted are not tracked"
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import { EMPTY_GUIDED_ONBOARDING_STATE } from "@langwatch/onboarding-contract";
import { describe, expect, it } from "vitest";

import {
  guidedOnboardingPersonProperties,
  guidedOnboardingTrackedEvent,
} from "../guided-onboarding-analytics.rules.ts";

describe("guidedOnboardingTrackedEvent", () => {
  it("names the PostHog event for a paths_selected write", () => {
    const tracked = guidedOnboardingTrackedEvent({
      event: "paths_selected",
      payload: {},
      state: EMPTY_GUIDED_ONBOARDING_STATE,
      organizationId: "org_1",
    });

    expect(tracked).toMatchObject({ tracked: true, name: "guided_onboarding_paths_selected" });
  });

  it("tracks nothing for conversation_attached or virtual_key_minted", () => {
    for (const event of ["conversation_attached", "virtual_key_minted"] as const) {
      const tracked = guidedOnboardingTrackedEvent({
        event,
        payload: {},
        state: EMPTY_GUIDED_ONBOARDING_STATE,
        organizationId: "org_1",
      });
      expect(tracked).toEqual({ tracked: false });
    }
  });

  it("carries only the provider and model for provider_connected", () => {
    const tracked = guidedOnboardingTrackedEvent({
      event: "provider_connected",
      payload: { provider: "openai", model: "gpt-5" },
      state: { ...EMPTY_GUIDED_ONBOARDING_STATE, provider: "openai", providerModel: "gpt-5" },
      organizationId: "org_1",
    });

    expect(tracked.tracked && tracked.properties.provider).toBe("openai");
    expect(tracked.tracked && tracked.properties.model).toBe("gpt-5");
    expect(tracked.tracked && tracked.properties.organization_id).toBe("org_1");
  });

  it("carries the current path for a tour event", () => {
    const tracked = guidedOnboardingTrackedEvent({
      event: "tour_completed",
      payload: {},
      state: { ...EMPTY_GUIDED_ONBOARDING_STATE, currentPath: "llmops" },
      organizationId: "org_1",
    });

    expect(tracked.tracked && tracked.properties.path).toBe("llmops");
  });
});

describe("guidedOnboardingPersonProperties", () => {
  it("sets the person properties to the guided variant and the picked paths", () => {
    const properties = guidedOnboardingPersonProperties({
      ...EMPTY_GUIDED_ONBOARDING_STATE,
      paths: ["gateway", "llmops"],
    });

    expect(properties).toEqual({
      onboarding_variant: "guided",
      onboarding_paths: ["gateway", "llmops"],
      onboarding_primary_path: "gateway",
    });
  });
});

/**
 * Guided event properties carry only the named payload fields; conversation
 * attached and virtual key minted are not tracked.
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import {
  EMPTY_GUIDED_ONBOARDING_STATE,
  ONBOARDING_EXPERIMENT_PROPERTY,
} from "@langwatch/onboarding-contract";
import { describe, expect, it } from "vitest";

import {
  guidedOnboardingPersonProperties,
  guidedOnboardingTrackedEvent,
} from "../guided-onboarding-analytics.rules.ts";

const TRACKED_EVENTS = [
  "paths_selected",
  "provider_connected",
  "provider_skipped",
  "tour_completed",
  "tour_skipped",
  "tour_replayed",
  "path_begun",
  "path_completed",
] as const;

function track({
  event,
  payload = {},
  state = EMPTY_GUIDED_ONBOARDING_STATE,
}: {
  event: (typeof TRACKED_EVENTS)[number] | "conversation_attached";
  payload?: Record<string, string | string[] | number | undefined>;
  state?: typeof EMPTY_GUIDED_ONBOARDING_STATE;
}) {
  return guidedOnboardingTrackedEvent({ event, payload, state, organizationId: "org_1" });
}

describe("guidedOnboardingTrackedEvent", () => {
  /** @scenario "selecting paths tracks the paths and the primary path" */
  it("carries the picked paths and the first as the primary path", () => {
    const tracked = track({
      event: "paths_selected",
      state: { ...EMPTY_GUIDED_ONBOARDING_STATE, paths: ["gateway", "llmops"] },
    });

    expect(tracked).toMatchObject({
      tracked: true,
      name: "guided_onboarding_paths_selected",
      properties: { paths: ["gateway", "llmops"], primary_path: "gateway" },
    });
  });

  /** @scenario "skipping the provider is tracked" */
  it("names the provider skip as its own event", () => {
    expect(track({ event: "provider_skipped" })).toMatchObject({
      tracked: true,
      name: "guided_onboarding_provider_skipped",
    });
  });

  /** @scenario "completing, skipping and replaying the tour are tracked with the current path" */
  it("names each tour step and carries the current path", () => {
    const state = { ...EMPTY_GUIDED_ONBOARDING_STATE, currentPath: "gateway" as const };

    expect(
      (["tour_completed", "tour_skipped", "tour_replayed"] as const).map((event) => {
        const tracked = track({ event, state });
        return tracked.tracked ? [tracked.name, tracked.properties.path] : null;
      }),
    ).toEqual([
      ["guided_onboarding_tour_completed", "gateway"],
      ["guided_onboarding_tour_skipped", "gateway"],
      ["guided_onboarding_tour_replayed", "gateway"],
    ]);
  });

  /** @scenario "beginning and completing a path are tracked with the path" */
  it("carries the path named in the payload for a path begun and completed", () => {
    expect(
      (["path_begun", "path_completed"] as const).map((event) => {
        const tracked = track({ event, payload: { path: "llmops" } });
        return tracked.tracked ? [tracked.name, tracked.properties.path] : null;
      }),
    ).toEqual([
      ["guided_onboarding_path_begun", "llmops"],
      ["guided_onboarding_path_completed", "llmops"],
    ]);
  });

  /** @scenario "connecting a provider tracks the provider and the model, never a key" */
  it("drops any other payload field, so a key cannot leave the process", () => {
    const tracked = track({
      event: "provider_connected",
      payload: { provider: "openai", model: "gpt-5", apiKey: "sk-secret" },
    });

    expect(tracked.tracked && JSON.stringify(tracked.properties)).not.toContain("sk-secret");
  });

  /** @scenario "every guided event sets the onboarding person properties" */
  it("sets the onboarding person properties on every tracked event", () => {
    const state = { ...EMPTY_GUIDED_ONBOARDING_STATE, paths: ["gateway" as const] };

    for (const event of TRACKED_EVENTS) {
      expect(track({ event, state })).toMatchObject({
        properties: {
          $set: { onboarding_variant: "guided", onboarding_primary_path: "gateway" },
        },
      });
    }
  });

  /** @scenario "every guided onboarding event carries the experiment property" */
  it("carries the experiment property on every tracked event", () => {
    for (const event of TRACKED_EVENTS) {
      expect(track({ event })).toMatchObject({
        properties: { [ONBOARDING_EXPERIMENT_PROPERTY]: "guided" },
      });
    }
  });

  it("names the PostHog event for a paths_selected write", () => {
    const tracked = guidedOnboardingTrackedEvent({
      event: "paths_selected",
      payload: {},
      state: EMPTY_GUIDED_ONBOARDING_STATE,
      organizationId: "org_1",
    });

    expect(tracked).toMatchObject({ tracked: true, name: "guided_onboarding_paths_selected" });
  });

  /** @scenario "attaching a conversation tracks nothing" */
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

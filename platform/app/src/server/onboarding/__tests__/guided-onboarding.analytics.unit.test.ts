/**
 * @vitest-environment node
 *
 * What each guided onboarding event becomes in PostHog: the event name, the
 * properties it carries, the person properties it sets, and what never
 * leaves the process.
 *
 * @see specs/analytics/posthog-guided-onboarding.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GuidedOnboardingState } from "~/server/schemas/sign-up-data.schema";
import {
  trackGuidedOnboardingEvent,
  trackOnboardingVariantAssigned,
} from "../guided-onboarding.analytics";
import type { AttributedGuidedOnboardingEvent } from "../guided-onboarding.events";

const { trackServerEvent } = vi.hoisted(() => ({ trackServerEvent: vi.fn() }));

vi.mock("~/server/posthog", () => ({ trackServerEvent }));

const EMPTY: GuidedOnboardingState = { paths: [], donePaths: [] };

function event(
  overrides: Partial<AttributedGuidedOnboardingEvent> & {
    event: AttributedGuidedOnboardingEvent["event"];
  },
): AttributedGuidedOnboardingEvent {
  return {
    organizationId: "org_1",
    userId: "user_1",
    payload: {},
    previous: EMPTY,
    state: EMPTY,
    ...overrides,
  };
}

function tracked(): { event: string; properties: Record<string, unknown> } {
  const calls = trackServerEvent.mock.calls;
  if (calls.length !== 1) {
    throw new Error(`expected exactly one tracked event, got ${calls.length}`);
  }
  return calls[0]![0];
}

describe("trackOnboardingVariantAssigned()", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("when an organization is initialized with the guided variant", () => {
    /** @scenario "initializing an organization tracks the assigned onboarding variant" */
    it("tracks onboarding_variant_assigned and sets the person property", () => {
      trackOnboardingVariantAssigned({
        userId: "user_1",
        organizationId: "org_1",
        variant: "guided",
      });

      expect(trackServerEvent).toHaveBeenCalledWith({
        userId: "user_1",
        event: "onboarding_variant_assigned",
        properties: {
          variant: "guided",
          organization_id: "org_1",
          $set: { onboarding_variant: "guided" },
        },
      });
    });
  });
});

describe("trackGuidedOnboardingEvent()", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("when paths are selected", () => {
    /** @scenario "selecting paths tracks the paths and the primary path" */
    it("tracks guided_onboarding_paths_selected with the paths and the primary path", () => {
      trackGuidedOnboardingEvent(
        event({
          event: "paths_selected",
          payload: { paths: ["gateway", "llmops"], primaryPath: "gateway" },
          state: {
            paths: ["gateway", "llmops"],
            donePaths: [],
            currentPath: "gateway",
          },
        }),
      );

      const call = tracked();
      expect(call.event).toBe("guided_onboarding_paths_selected");
      expect(call.properties.paths).toEqual(["gateway", "llmops"]);
      expect(call.properties.primary_path).toBe("gateway");
    });
  });

  describe("when a provider is connected", () => {
    /** @scenario "connecting a provider tracks the provider and the model, never a key" */
    it("tracks the provider and the model and nothing else from the payload", () => {
      trackGuidedOnboardingEvent(
        event({
          event: "provider_connected",
          payload: { provider: "openai", model: "gpt-5", apiKey: "sk-SECRET" },
          state: { ...EMPTY, provider: "openai", providerModel: "gpt-5" },
        }),
      );

      const call = tracked();
      expect(call.event).toBe("guided_onboarding_provider_connected");
      expect(call.properties.provider).toBe("openai");
      expect(call.properties.model).toBe("gpt-5");
      expect(JSON.stringify(call)).not.toContain("sk-SECRET");
      expect(JSON.stringify(call)).not.toContain("apiKey");
    });
  });

  describe("when the provider is skipped", () => {
    /** @scenario "skipping the provider is tracked" */
    it("tracks guided_onboarding_provider_skipped", () => {
      trackGuidedOnboardingEvent(event({ event: "provider_skipped" }));

      expect(tracked().event).toBe("guided_onboarding_provider_skipped");
    });
  });

  describe("when the tour is completed, skipped and replayed on the gateway path", () => {
    /** @scenario "completing, skipping and replaying the tour are tracked with the current path" */
    it("tracks each with path gateway", () => {
      const state: GuidedOnboardingState = {
        paths: ["gateway"],
        donePaths: [],
        currentPath: "gateway",
      };

      trackGuidedOnboardingEvent(event({ event: "tour_completed", state }));
      trackGuidedOnboardingEvent(event({ event: "tour_skipped", state }));
      trackGuidedOnboardingEvent(event({ event: "tour_replayed", state }));

      expect(trackServerEvent.mock.calls.map((call) => call[0].event)).toEqual([
        "guided_onboarding_tour_completed",
        "guided_onboarding_tour_skipped",
        "guided_onboarding_tour_replayed",
      ]);
      for (const call of trackServerEvent.mock.calls) {
        expect(call[0].properties.path).toBe("gateway");
      }
    });
  });

  describe("when a path is begun and then completed", () => {
    /** @scenario "beginning and completing a path are tracked with the path" */
    it("tracks both with the path", () => {
      trackGuidedOnboardingEvent(
        event({ event: "path_begun", payload: { path: "governance" } }),
      );
      trackGuidedOnboardingEvent(
        event({ event: "path_completed", payload: { path: "governance" } }),
      );

      expect(trackServerEvent).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          event: "guided_onboarding_path_begun",
          properties: expect.objectContaining({ path: "governance" }),
        }),
      );
      expect(trackServerEvent).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          event: "guided_onboarding_path_completed",
          properties: expect.objectContaining({ path: "governance" }),
        }),
      );
    });
  });

  describe("when a conversation is attached", () => {
    /** @scenario "attaching a conversation tracks nothing" */
    it("tracks no event", () => {
      trackGuidedOnboardingEvent(
        event({
          event: "conversation_attached",
          payload: { conversationId: "conv_1" },
        }),
      );

      expect(trackServerEvent).not.toHaveBeenCalled();
    });
  });

  describe("for any guided event", () => {
    /** @scenario "every guided event sets the onboarding person properties" */
    it("sets onboarding_variant, onboarding_paths and onboarding_primary_path on the person", () => {
      trackGuidedOnboardingEvent(
        event({
          event: "provider_skipped",
          state: { paths: ["gateway", "llmops"], donePaths: [] },
        }),
      );

      expect(tracked().properties).toMatchObject({
        organization_id: "org_1",
        $set: {
          onboarding_variant: "guided",
          onboarding_paths: ["gateway", "llmops"],
          onboarding_primary_path: "gateway",
        },
      });
    });
  });
});

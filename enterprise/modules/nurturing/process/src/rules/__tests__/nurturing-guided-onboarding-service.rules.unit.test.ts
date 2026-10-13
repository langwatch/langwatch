/**
 * What guided onboarding tells Customer.io and PostHog.
 * @see specs/features/customer-io-nurturing-integration.feature
 * @see specs/analytics/posthog-guided-onboarding.feature
 */
import {
  ONBOARDING_EXPERIMENT_PROPERTY,
  type GuidedOnboardingState,
  type GuidedPath,
} from "@langwatch/onboarding-contract";
import { describe, expect, it } from "vitest";

import {
  fireGuidedOnboardingPaths,
  fireGuidedOnboardingPostHog,
  fireGuidedOnboardingProgress,
  guidedOnboardingOrgTraits,
  guidedOnboardingPersonTraits,
} from "../nurturing-guided-onboarding-service.rules.ts";

const EMPTY: GuidedOnboardingState = { paths: [], donePaths: [] };

describe("fireGuidedOnboardingPaths()", () => {
  describe("when the user selects gateway then llmops", () => {
    const select = () =>
      fireGuidedOnboardingPaths({
        userId: "user-1",
        organizationId: "org-1",
        event: "paths_selected",
        previousPaths: [],
        paths: ["gateway", "llmops"],
      });

    /** @scenario 'selecting paths identifies the user with the onboarding traits' */
    it("decides to identify the user with the variant, the paths and the primary path", () => {
      expect(select()[0]).toMatchObject({
        type: "identify",
        userId: "user-1",
        traits: {
          onboarding_variant: "guided",
          onboarding_paths: "gateway,llmops",
          onboarding_primary_path: "gateway",
        },
      });
    });

    /** @scenario 'selecting paths pushes the same traits to the organization group' */
    it("decides to push the same traits to the organization group", () => {
      expect(select()[1]).toMatchObject({
        type: "group",
        userId: "user-1",
        groupId: "org-1",
        traits: {
          onboarding_variant: "guided",
          onboarding_paths: "gateway,llmops",
          onboarding_primary_path: "gateway",
        },
      });
    });

    /** @scenario 'selecting paths fires the paths event with the paths and the primary path' */
    it("decides to track onboarding_paths_selected with the paths and the primary path", () => {
      expect(select()).toContainEqual({
        type: "track",
        userId: "user-1",
        event: "onboarding_paths_selected",
        properties: { paths: "gateway,llmops", primary_path: "gateway" },
      });
    });
  });

  describe("when the user selects gateway, llmops and coding", () => {
    /** @scenario 'selecting paths fires one campaign trigger per path, once each' */
    it("decides on one campaign trigger per path exactly once", () => {
      const calls = fireGuidedOnboardingPaths({
        userId: "user-1",
        organizationId: "org-1",
        event: "paths_selected",
        previousPaths: [],
        paths: ["gateway", "llmops", "coding"],
      });

      const events = calls.filter((call) => call.type === "track").map((call) => call.event);
      expect(events.filter((event) => event === "onboarding_path_gateway")).toHaveLength(1);
      expect(events.filter((event) => event === "onboarding_path_llmops")).toHaveLength(1);
      expect(events.filter((event) => event === "onboarding_path_coding_agents")).toHaveLength(1);
      expect(events).not.toContain("onboarding_path_governance");
    });
  });

  describe("when the user begins a path they never picked", () => {
    /** @scenario "beginning a path the user never picked fires that path's campaign trigger" */
    it("decides on only that path's campaign trigger and no paths event", () => {
      const calls = fireGuidedOnboardingPaths({
        userId: "user-1",
        organizationId: "org-1",
        event: "path_begun",
        previousPaths: ["llmops"],
        paths: ["llmops", "governance"],
      });

      expect(calls.filter((call) => call.type === "track").map((call) => call.event)).toEqual([
        "onboarding_path_governance",
      ]);
      expect(calls[0]).toMatchObject({
        type: "identify",
        traits: {
          onboarding_variant: "guided",
          onboarding_paths: "llmops,governance",
          onboarding_primary_path: "llmops",
        },
      });
    });
  });

  describe("when the user begins a path they already picked", () => {
    /** @scenario 'beginning a path the user already picked fires no campaign trigger' */
    it("decides on no track call", () => {
      const calls = fireGuidedOnboardingPaths({
        userId: "user-1",
        organizationId: "org-1",
        event: "path_begun",
        previousPaths: ["gateway", "llmops"],
        paths: ["gateway", "llmops"],
      });

      expect(calls.filter((call) => call.type === "track")).toHaveLength(0);
    });
  });
});

describe("fireGuidedOnboardingProgress()", () => {
  describe("when a provider is connected", () => {
    /** @scenario 'connecting a provider identifies the provider, never a key' */
    it("decides to identify the provider and nothing else from the payload", () => {
      const calls = fireGuidedOnboardingProgress({
        userId: "user-1",
        organizationId: "org-1",
        event: "provider_connected",
        payload: { provider: "openai", model: "gpt-5", apiKey: "sk-SECRET" },
        state: { ...EMPTY, provider: "openai", providerModel: "gpt-5" },
      });

      expect(calls).toEqual([
        { type: "identify", userId: "user-1", traits: { guided_onboarding_provider: "openai" } },
      ]);
      expect(JSON.stringify(calls)).not.toContain("sk-SECRET");
    });
  });

  describe("when the tour is completed", () => {
    /** @scenario 'completing the tour identifies the tour as completed' */
    it("decides to identify guided_onboarding_tour completed", () => {
      const calls = fireGuidedOnboardingProgress({
        userId: "user-1",
        organizationId: "org-1",
        event: "tour_completed",
        payload: {},
        state: { ...EMPTY, tourCompletedAt: "2026-09-05T10:00:00.000Z" },
      });

      expect(calls).toEqual([
        { type: "identify", userId: "user-1", traits: { guided_onboarding_tour: "completed" } },
      ]);
    });
  });

  describe("when the tour is skipped", () => {
    /** @scenario 'skipping the tour identifies the tour as skipped' */
    it("decides to identify guided_onboarding_tour skipped", () => {
      const calls = fireGuidedOnboardingProgress({
        userId: "user-1",
        organizationId: "org-1",
        event: "tour_skipped",
        payload: {},
        state: { ...EMPTY, tourSkippedAt: "2026-09-05T10:00:00.000Z" },
      });

      expect(calls).toEqual([
        { type: "identify", userId: "user-1", traits: { guided_onboarding_tour: "skipped" } },
      ]);
    });
  });

  describe("when the gateway path is completed with llmops already done", () => {
    /** @scenario 'completing a path identifies the completed paths and fires the completion event' */
    it("decides to identify the completed paths with the time, group them and track the completion", () => {
      const calls = fireGuidedOnboardingProgress({
        userId: "user-1",
        organizationId: "org-1",
        event: "path_completed",
        payload: { path: "gateway" },
        state: { paths: ["gateway", "llmops"], donePaths: ["gateway", "llmops"] },
      });

      expect(calls[0]).toMatchObject({
        type: "identify",
        traits: {
          guided_onboarding_completed_paths: "gateway,llmops",
          guided_onboarding_completed_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
        },
      });
      expect(calls[1]).toMatchObject({
        type: "group",
        traits: { guided_onboarding_completed_paths: "gateway,llmops" },
      });
      expect(calls[2]).toMatchObject({
        type: "track",
        event: "guided_onboarding_path_completed",
        properties: { path: "gateway" },
      });
    });
  });
});

describe("the traits a guided onboarding state reads as", () => {
  /** @scenario 'skipping the provider, replaying the tour and attaching a conversation send nothing' */
  it("reads nothing extra from events the paths and progress hooks never route", () => {
    expect(
      guidedOnboardingPersonTraits({
        variant: "guided",
        state: { ...EMPTY, providerSkippedAt: "x", tourReplays: 2, conversationId: "c" },
      }),
    ).toEqual({ onboarding_variant: "guided" });
  });

  it("reads every trait out of a full state", () => {
    const state: GuidedOnboardingState = {
      paths: ["gateway", "llmops"],
      donePaths: ["gateway"],
      currentPath: "llmops",
      provider: "openai",
      providerModel: "gpt-5",
      tourCompletedAt: "2026-09-05T10:00:00.000Z",
    };

    expect(guidedOnboardingPersonTraits({ variant: "guided", state })).toEqual({
      onboarding_variant: "guided",
      onboarding_paths: "gateway,llmops",
      onboarding_primary_path: "gateway",
      guided_onboarding_provider: "openai",
      guided_onboarding_tour: "completed",
      guided_onboarding_completed_paths: "gateway",
    });
    expect(guidedOnboardingOrgTraits({ variant: "guided", state })).toEqual({
      onboarding_variant: "guided",
      onboarding_paths: "gateway,llmops",
      onboarding_primary_path: "gateway",
      guided_onboarding_completed_paths: "gateway",
    });
  });

  it("reads a skipped tour and a classic variant", () => {
    expect(
      guidedOnboardingPersonTraits({
        variant: "classic",
        state: { ...EMPTY, tourSkippedAt: "2026-09-05T10:00:00.000Z" },
      }),
    ).toEqual({ onboarding_variant: "classic", guided_onboarding_tour: "skipped" });
  });
});

describe("fireGuidedOnboardingProgress() for steps Customer.io is not told of", () => {
  /** @scenario "skipping the provider, replaying the tour and attaching a conversation send nothing" */
  it("decides no call for a provider skipped or a tour replayed", () => {
    for (const event of ["provider_skipped", "tour_replayed"] as const) {
      expect(
        fireGuidedOnboardingProgress({
          userId: "user-1",
          organizationId: "org-1",
          event,
          payload: {},
          state: EMPTY,
        }),
      ).toEqual([]);
    }
  });
});

describe("fireGuidedOnboardingPostHog()", () => {
  const POSTHOG_EVENTS = [
    "paths_selected",
    "path_begun",
    "provider_connected",
    "provider_skipped",
    "tour_completed",
    "tour_skipped",
    "tour_replayed",
    "path_completed",
  ] as const;

  function decide({
    event,
    payload = {},
    paths = [],
    currentPath,
  }: {
    event: (typeof POSTHOG_EVENTS)[number];
    payload?: Record<string, string | string[] | number | undefined>;
    paths?: GuidedPath[];
    currentPath?: GuidedPath;
  }) {
    return fireGuidedOnboardingPostHog({
      userId: "user-1",
      organizationId: "org_1",
      event,
      payload,
      paths,
      currentPath,
    });
  }

  /** @scenario "selecting paths tracks the paths and the primary path" */
  it("carries the picked paths and the first as the primary path", () => {
    expect(decide({ event: "paths_selected", paths: ["gateway", "llmops"] })).toMatchObject({
      userId: "user-1",
      event: "guided_onboarding_paths_selected",
      properties: { paths: ["gateway", "llmops"], primary_path: "gateway" },
    });
  });

  /** @scenario "skipping the provider is tracked" */
  it("names the provider skip as its own event", () => {
    expect(decide({ event: "provider_skipped" })).toMatchObject({
      event: "guided_onboarding_provider_skipped",
    });
  });

  /** @scenario "completing, skipping and replaying the tour are tracked with the current path" */
  it("names each tour step and carries the current path", () => {
    expect(
      (["tour_completed", "tour_skipped", "tour_replayed"] as const).map((event) => {
        const decided = decide({ event, currentPath: "gateway" });
        return [decided.event, decided.properties.path];
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
        const decided = decide({ event, payload: { path: "llmops" } });
        return [decided.event, decided.properties.path];
      }),
    ).toEqual([
      ["guided_onboarding_path_begun", "llmops"],
      ["guided_onboarding_path_completed", "llmops"],
    ]);
  });

  /** @scenario "connecting a provider tracks the provider and the model, never a key" */
  it("carries the provider and the model and drops any other payload field", () => {
    const decided = decide({
      event: "provider_connected",
      payload: { provider: "openai", model: "gpt-5", apiKey: "sk-secret" },
    });

    expect(decided.properties).toMatchObject({
      provider: "openai",
      model: "gpt-5",
      organization_id: "org_1",
    });
    expect(JSON.stringify(decided)).not.toContain("sk-secret");
  });

  /** @scenario "every guided event sets the onboarding person properties" */
  it("sets the onboarding person properties on every event", () => {
    for (const event of POSTHOG_EVENTS) {
      expect(decide({ event, paths: ["gateway", "llmops"] }).properties).toMatchObject({
        $set: {
          onboarding_variant: "guided",
          onboarding_paths: ["gateway", "llmops"],
          onboarding_primary_path: "gateway",
        },
      });
    }
  });

  /** @scenario "every guided onboarding event carries the experiment property" */
  it("carries the experiment property on every event", () => {
    for (const event of POSTHOG_EVENTS) {
      expect(decide({ event }).properties).toMatchObject({
        [ONBOARDING_EXPERIMENT_PROPERTY]: "guided",
      });
    }
  });
});

/**
 * What guided onboarding tells Customer.io.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import type { GuidedOnboardingState } from "@langwatch/onboarding-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  registerNoNurturingSink,
  registerNurturingSink,
  settle,
} from "../../services/__tests__/support/nurturing-harness.ts";
import {
  fireGuidedOnboardingPaths,
  fireGuidedOnboardingProgress,
  guidedOnboardingOrgTraits,
  guidedOnboardingPersonTraits,
} from "../nurturing-guided-onboarding-service.rules.ts";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const EMPTY: GuidedOnboardingState = { paths: [], donePaths: [] };

beforeEach(() => vi.clearAllMocks());
afterEach(() => registerNoNurturingSink());

describe("fireGuidedOnboardingPaths()", () => {
  describe("when the user selects gateway then llmops", () => {
    const select = (sink: ReturnType<typeof registerNurturingSink>) => {
      fireGuidedOnboardingPaths({
        userId: "user-1",
        organizationId: "org-1",
        event: "paths_selected",
        previousPaths: [],
        paths: ["gateway", "llmops"],
      });
      return sink;
    };

    /** @scenario 'selecting paths identifies the user with the onboarding traits' */
    it("identifies the user with the variant, the paths and the primary path", async () => {
      const sink = select(registerNurturingSink());
      await settle();

      expect(sink.sentTo("/identify")[0]).toMatchObject({
        userId: "user-1",
        traits: {
          onboarding_variant: "guided",
          onboarding_paths: "gateway,llmops",
          onboarding_primary_path: "gateway",
        },
      });
    });

    /** @scenario 'selecting paths pushes the same traits to the organization group' */
    it("pushes the same traits to the organization group", async () => {
      const sink = select(registerNurturingSink());
      await settle();

      expect(sink.sentTo("/group")[0]).toMatchObject({
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
    it("tracks onboarding_paths_selected with the paths and the primary path", async () => {
      const sink = select(registerNurturingSink());
      await settle();

      expect(sink.sentTo("/track")).toContainEqual({
        userId: "user-1",
        event: "onboarding_paths_selected",
        properties: { paths: "gateway,llmops", primary_path: "gateway" },
      });
    });
  });

  describe("when the user selects gateway, llmops and coding", () => {
    /** @scenario 'selecting paths fires one campaign trigger per path, once each' */
    it("tracks one campaign trigger per path exactly once", async () => {
      const sink = registerNurturingSink();

      fireGuidedOnboardingPaths({
        userId: "user-1",
        organizationId: "org-1",
        event: "paths_selected",
        previousPaths: [],
        paths: ["gateway", "llmops", "coding"],
      });
      await settle();

      const events = sink.sentTo("/track").map((call) => call.event);
      expect(events.filter((event) => event === "onboarding_path_gateway")).toHaveLength(1);
      expect(events.filter((event) => event === "onboarding_path_llmops")).toHaveLength(1);
      expect(events.filter((event) => event === "onboarding_path_coding_agents")).toHaveLength(1);
      expect(events).not.toContain("onboarding_path_governance");
    });
  });

  describe("when the user begins a path they never picked", () => {
    /** @scenario "beginning a path the user never picked fires that path's campaign trigger" */
    it("tracks only that path's campaign trigger and no paths event", async () => {
      const sink = registerNurturingSink();

      fireGuidedOnboardingPaths({
        userId: "user-1",
        organizationId: "org-1",
        event: "path_begun",
        previousPaths: ["llmops"],
        paths: ["llmops", "governance"],
      });
      await settle();

      expect(sink.sentTo("/track").map((call) => call.event)).toEqual([
        "onboarding_path_governance",
      ]);
      expect(sink.sentTo("/identify")[0]).toMatchObject({
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
    it("tracks no event", async () => {
      const sink = registerNurturingSink();

      fireGuidedOnboardingPaths({
        userId: "user-1",
        organizationId: "org-1",
        event: "path_begun",
        previousPaths: ["gateway", "llmops"],
        paths: ["gateway", "llmops"],
      });
      await settle();

      expect(sink.sentTo("/track")).toHaveLength(0);
    });
  });

  describe("when nurturing has no configured sink", () => {
    /** @scenario 'without a Customer.io key nothing is sent' */
    it("silently skips without throwing", () => {
      registerNoNurturingSink();

      expect(() =>
        fireGuidedOnboardingPaths({
          userId: "user-1",
          organizationId: "org-1",
          event: "paths_selected",
          previousPaths: [],
          paths: ["gateway"],
        }),
      ).not.toThrow();
      expect(() =>
        fireGuidedOnboardingProgress({
          userId: "user-1",
          organizationId: "org-1",
          event: "path_completed",
          payload: { path: "gateway" },
          state: { paths: ["gateway"], donePaths: ["gateway"] },
        }),
      ).not.toThrow();
    });
  });
});

describe("fireGuidedOnboardingProgress()", () => {
  describe("when a provider is connected", () => {
    /** @scenario 'connecting a provider identifies the provider, never a key' */
    it("identifies the provider and nothing else from the payload", async () => {
      const sink = registerNurturingSink();

      fireGuidedOnboardingProgress({
        userId: "user-1",
        organizationId: "org-1",
        event: "provider_connected",
        payload: { provider: "openai", model: "gpt-5", apiKey: "sk-SECRET" },
        state: { ...EMPTY, provider: "openai", providerModel: "gpt-5" },
      });
      await settle();

      expect(sink.sentTo("/identify")[0]).toMatchObject({
        traits: { guided_onboarding_provider: "openai" },
      });
      expect(JSON.stringify(sink.sent())).not.toContain("sk-SECRET");
      expect(sink.sentTo("/track")).toHaveLength(0);
    });
  });

  describe("when the tour is completed", () => {
    /** @scenario 'completing the tour identifies the tour as completed' */
    it("identifies guided_onboarding_tour completed", async () => {
      const sink = registerNurturingSink();

      fireGuidedOnboardingProgress({
        userId: "user-1",
        organizationId: "org-1",
        event: "tour_completed",
        payload: {},
        state: { ...EMPTY, tourCompletedAt: "2026-09-05T10:00:00.000Z" },
      });
      await settle();

      expect(sink.sentTo("/identify")[0]).toMatchObject({
        traits: { guided_onboarding_tour: "completed" },
      });
    });
  });

  describe("when the tour is skipped", () => {
    /** @scenario 'skipping the tour identifies the tour as skipped' */
    it("identifies guided_onboarding_tour skipped", async () => {
      const sink = registerNurturingSink();

      fireGuidedOnboardingProgress({
        userId: "user-1",
        organizationId: "org-1",
        event: "tour_skipped",
        payload: {},
        state: { ...EMPTY, tourSkippedAt: "2026-09-05T10:00:00.000Z" },
      });
      await settle();

      expect(sink.sentTo("/identify")[0]).toMatchObject({
        traits: { guided_onboarding_tour: "skipped" },
      });
    });
  });

  describe("when the gateway path is completed with llmops already done", () => {
    /** @scenario 'completing a path identifies the completed paths and fires the completion event' */
    it("identifies the completed paths with the time, groups them and tracks the completion", async () => {
      const sink = registerNurturingSink();

      fireGuidedOnboardingProgress({
        userId: "user-1",
        organizationId: "org-1",
        event: "path_completed",
        payload: { path: "gateway" },
        state: { paths: ["gateway", "llmops"], donePaths: ["gateway", "llmops"] },
      });
      await settle();

      expect(sink.sentTo("/identify")[0]).toMatchObject({
        traits: {
          guided_onboarding_completed_paths: "gateway,llmops",
          guided_onboarding_completed_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
        },
      });
      expect(sink.sentTo("/group")[0]).toMatchObject({
        traits: { guided_onboarding_completed_paths: "gateway,llmops" },
      });
      expect(sink.sentTo("/track")[0]).toMatchObject({
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

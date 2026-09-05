import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GuidedOnboardingState } from "../../../../src/server/schemas/sign-up-data.schema";
import {
  fireGuidedOnboardingPathsNurturing,
  fireGuidedOnboardingProgressNurturing,
  guidedOnboardingOrgTraits,
  guidedOnboardingPersonTraits,
} from "./guidedOnboarding";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));
vi.mock("../../../../src/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
  toError: vi.fn((e) => (e instanceof Error ? e : new Error(String(e)))),
}));

const mockNurturing = {
  identifyUser: vi.fn().mockResolvedValue(undefined),
  trackEvent: vi.fn().mockResolvedValue(undefined),
  groupUser: vi.fn().mockResolvedValue(undefined),
  batch: vi.fn().mockResolvedValue(undefined),
};

let currentNurturing: typeof mockNurturing | undefined = mockNurturing;

vi.mock("../../../../src/server/app-layer/app", () => ({
  // Consumers that degrade without Redis read through this one.
  tryGetApp: () => null,
  getApp: () => ({
    get nurturing() {
      return currentNurturing;
    },
  }),
}));

const EMPTY: GuidedOnboardingState = { paths: [], donePaths: [] };

function trackedEvents(): string[] {
  return mockNurturing.trackEvent.mock.calls.map((call) => call[0].event);
}

describe("fireGuidedOnboardingPathsNurturing()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentNurturing = mockNurturing;
  });

  describe("when the user selects gateway then llmops", () => {
    const select = () =>
      fireGuidedOnboardingPathsNurturing({
        userId: "user-1",
        organizationId: "org-1",
        event: "paths_selected",
        previousPaths: [],
        paths: ["gateway", "llmops"],
      });

    /** @scenario 'selecting paths identifies the user with the onboarding traits' */
    it("identifies the user with the variant, the paths and the primary path", () => {
      select();

      expect(mockNurturing.identifyUser).toHaveBeenCalledWith({
        userId: "user-1",
        traits: {
          onboarding_variant: "guided",
          onboarding_paths: "gateway,llmops",
          onboarding_primary_path: "gateway",
        },
      });
    });

    /** @scenario 'selecting paths pushes the same traits to the organization group' */
    it("pushes the same traits to the organization group", () => {
      select();

      expect(mockNurturing.groupUser).toHaveBeenCalledWith({
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
    it("tracks onboarding_paths_selected with the paths and the primary path", () => {
      select();

      expect(mockNurturing.trackEvent).toHaveBeenCalledWith({
        userId: "user-1",
        event: "onboarding_paths_selected",
        properties: { paths: "gateway,llmops", primary_path: "gateway" },
      });
    });
  });

  describe("when the user selects gateway, llmops and coding", () => {
    /** @scenario 'selecting paths fires one campaign trigger per path, once each' */
    it("tracks one campaign trigger per path exactly once", () => {
      fireGuidedOnboardingPathsNurturing({
        userId: "user-1",
        organizationId: "org-1",
        event: "paths_selected",
        previousPaths: [],
        paths: ["gateway", "llmops", "coding"],
      });

      const events = trackedEvents();
      expect(
        events.filter((e) => e === "onboarding_path_gateway"),
      ).toHaveLength(1);
      expect(events.filter((e) => e === "onboarding_path_llmops")).toHaveLength(
        1,
      );
      expect(
        events.filter((e) => e === "onboarding_path_coding_agents"),
      ).toHaveLength(1);
      expect(events).not.toContain("onboarding_path_governance");
      expect(mockNurturing.trackEvent).toHaveBeenCalledWith({
        userId: "user-1",
        event: "onboarding_path_coding_agents",
        properties: { path: "coding" },
      });
    });
  });

  describe("when the user begins a path they never picked", () => {
    /** @scenario "beginning a path the user never picked fires that path's campaign trigger" */
    it("tracks only that path's campaign trigger and no paths event", () => {
      fireGuidedOnboardingPathsNurturing({
        userId: "user-1",
        organizationId: "org-1",
        event: "path_begun",
        previousPaths: ["llmops"],
        paths: ["llmops", "governance"],
      });

      expect(trackedEvents()).toEqual(["onboarding_path_governance"]);
      expect(mockNurturing.identifyUser).toHaveBeenCalledWith({
        userId: "user-1",
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
    it("tracks no event", () => {
      fireGuidedOnboardingPathsNurturing({
        userId: "user-1",
        organizationId: "org-1",
        event: "path_begun",
        previousPaths: ["gateway", "llmops"],
        paths: ["gateway", "llmops"],
      });

      expect(mockNurturing.trackEvent).not.toHaveBeenCalled();
    });
  });

  describe("when nurturing is undefined (no Customer.io key)", () => {
    /** @scenario 'without a Customer.io key nothing is sent' */
    it("silently skips without calling any nurturing methods", () => {
      currentNurturing = undefined;

      fireGuidedOnboardingPathsNurturing({
        userId: "user-1",
        organizationId: "org-1",
        event: "paths_selected",
        previousPaths: [],
        paths: ["gateway"],
      });
      fireGuidedOnboardingProgressNurturing({
        userId: "user-1",
        organizationId: "org-1",
        event: "path_completed",
        payload: { path: "gateway" },
        state: { paths: ["gateway"], donePaths: ["gateway"] },
      });

      expect(mockNurturing.identifyUser).not.toHaveBeenCalled();
      expect(mockNurturing.groupUser).not.toHaveBeenCalled();
      expect(mockNurturing.trackEvent).not.toHaveBeenCalled();
    });
  });

  describe("when Customer.io API is unavailable", () => {
    it("does not throw and captures the failure", async () => {
      const { captureException } = await import(
        "../../../../src/utils/posthogErrorCapture"
      );
      mockNurturing.trackEvent.mockRejectedValueOnce(
        new Error("CIO unavailable"),
      );

      expect(() =>
        fireGuidedOnboardingPathsNurturing({
          userId: "user-1",
          organizationId: "org-1",
          event: "paths_selected",
          previousPaths: [],
          paths: ["gateway"],
        }),
      ).not.toThrow();

      await vi.waitFor(() => {
        expect(captureException).toHaveBeenCalled();
      });
    });
  });
});

describe("fireGuidedOnboardingProgressNurturing()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentNurturing = mockNurturing;
  });

  describe("when a provider is connected", () => {
    /** @scenario 'connecting a provider identifies the provider, never a key' */
    it("identifies the provider and nothing else from the payload", () => {
      fireGuidedOnboardingProgressNurturing({
        userId: "user-1",
        organizationId: "org-1",
        event: "provider_connected",
        payload: { provider: "openai", model: "gpt-5", apiKey: "sk-SECRET" },
        state: { ...EMPTY, provider: "openai", providerModel: "gpt-5" },
      });

      expect(mockNurturing.identifyUser).toHaveBeenCalledWith({
        userId: "user-1",
        traits: { guided_onboarding_provider: "openai" },
      });
      expect(
        JSON.stringify(mockNurturing.identifyUser.mock.calls),
      ).not.toContain("sk-SECRET");
      expect(mockNurturing.trackEvent).not.toHaveBeenCalled();
    });
  });

  describe("when the tour is completed", () => {
    /** @scenario 'completing the tour identifies the tour as completed' */
    it("identifies guided_onboarding_tour completed", () => {
      fireGuidedOnboardingProgressNurturing({
        userId: "user-1",
        organizationId: "org-1",
        event: "tour_completed",
        payload: {},
        state: { ...EMPTY, tourCompletedAt: "2026-09-05T10:00:00.000Z" },
      });

      expect(mockNurturing.identifyUser).toHaveBeenCalledWith({
        userId: "user-1",
        traits: { guided_onboarding_tour: "completed" },
      });
    });
  });

  describe("when the tour is skipped", () => {
    /** @scenario 'skipping the tour identifies the tour as skipped' */
    it("identifies guided_onboarding_tour skipped", () => {
      fireGuidedOnboardingProgressNurturing({
        userId: "user-1",
        organizationId: "org-1",
        event: "tour_skipped",
        payload: {},
        state: { ...EMPTY, tourSkippedAt: "2026-09-05T10:00:00.000Z" },
      });

      expect(mockNurturing.identifyUser).toHaveBeenCalledWith({
        userId: "user-1",
        traits: { guided_onboarding_tour: "skipped" },
      });
    });
  });

  describe("when the gateway path is completed with llmops already done", () => {
    /** @scenario 'completing a path identifies the completed paths and fires the completion event' */
    it("identifies the completed paths with the time, groups them and tracks the completion", () => {
      fireGuidedOnboardingProgressNurturing({
        userId: "user-1",
        organizationId: "org-1",
        event: "path_completed",
        payload: { path: "gateway" },
        state: {
          paths: ["gateway", "llmops"],
          donePaths: ["gateway", "llmops"],
        },
      });

      expect(mockNurturing.identifyUser).toHaveBeenCalledWith({
        userId: "user-1",
        traits: {
          guided_onboarding_completed_paths: "gateway,llmops",
          guided_onboarding_completed_at:
            expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        },
      });
      expect(mockNurturing.groupUser).toHaveBeenCalledWith({
        userId: "user-1",
        groupId: "org-1",
        traits: { guided_onboarding_completed_paths: "gateway,llmops" },
      });
      expect(mockNurturing.trackEvent).toHaveBeenCalledWith({
        userId: "user-1",
        event: "guided_onboarding_path_completed",
        properties: { path: "gateway" },
      });
    });
  });
});

describe("the traits a guided onboarding state reads as", () => {
  /** @scenario 'skipping the provider, replaying the tour and attaching a conversation send nothing' */
  it("is what the events with nothing for nurturing never send: the router sends them nowhere", () => {
    // Those three events never reach the progress or the paths hook (see
    // guided-onboarding.events.unit.test.ts); this pins the trait readers
    // they would have nothing to add to.
    expect(
      guidedOnboardingPersonTraits({
        variant: "guided",
        state: {
          ...EMPTY,
          providerSkippedAt: "x",
          tourReplays: 2,
          conversationId: "c",
        },
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
    ).toEqual({
      onboarding_variant: "classic",
      guided_onboarding_tour: "skipped",
    });
  });
});

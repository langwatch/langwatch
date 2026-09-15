import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({
    apiKey: "test-key",
    source: "env",
    endpoint: "https://app.langwatch.ai",
  })),
}));

const { getGuidedState, completePath } = vi.hoisted(() => ({
  getGuidedState: vi.fn(),
  completePath: vi.fn(),
}));

vi.mock("@/client-sdk/services/onboarding/onboarding-api.service", () => ({
  OnboardingApiService: class {
    getGuidedState = getGuidedState;
    completePath = completePath;
  },
}));

import { resolveCredentials } from "../../../utils/apiKey";
import { onboardingCompletePathCommand } from "../complete-path";
import { onboardingStateCommand } from "../state";

const STATE = {
  paths: ["llmops", "gateway"],
  currentPath: "llmops",
  donePaths: [],
  provider: "openai",
  providerModel: "gpt-5",
};

/** What the platform answers: the picks plus what stays the platform's. */
const ANSWERED = {
  ...STATE,
  tourCompletedAt: "2026-09-06T10:00:00.000Z",
  conversationId: "langyconv_1",
  tourReplays: 2,
};

/** What the card shows for that answer, in customer copy. */
const CARD = {
  paths: "Evals & LLM Ops, Gateway",
  currentPath: "Evals & LLM Ops",
  provider: "OpenAI · gpt-5",
  tour: "Completed",
};

const noop = () => {
  // suppresses output during tests
};

describe("langwatch onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(noop);
  });

  describe("given `langwatch onboarding state` runs", () => {
    /** @scenario "the CLI prints the guided state as JSON" */
    it("resolves credentials first and prints the state the platform answered", async () => {
      getGuidedState.mockResolvedValue(ANSWERED);
      const log = vi.spyOn(console, "log").mockImplementation(noop);

      const result = await onboardingStateCommand();

      expect(resolveCredentials).toHaveBeenCalledTimes(1);
      expect(
        vi.mocked(resolveCredentials).mock.invocationCallOrder[0]!,
      ).toBeLessThan(getGuidedState.mock.invocationCallOrder[0]!);
      expect(result?.data).toEqual(CARD);

      result?.table();
      expect(JSON.parse(log.mock.calls[0]![0] as string)).toEqual(CARD);
    });

    /** @scenario "the onboarding card carries what the person reads and nothing else" */
    it("keeps the platform's own fields and every internal value off the card", async () => {
      getGuidedState.mockResolvedValue(ANSWERED);

      const result = await onboardingStateCommand();

      const printed = JSON.stringify(result?.data);
      expect(printed).not.toContain("langyconv_1");
      expect(printed).not.toContain("2026-09-06");
      expect(printed).not.toContain("tourReplays");
      expect(printed).not.toContain("conversationId");
      expect(printed).not.toContain("llmops");
      expect(printed).not.toContain("openai");
      expect(printed).not.toContain("donePaths");
    });

    it("names the done paths by their titles once there are any", async () => {
      getGuidedState.mockResolvedValue({
        ...ANSWERED,
        currentPath: "gateway",
        donePaths: ["llmops"],
      });

      const result = await onboardingStateCommand();

      expect(result?.data).toEqual({
        ...CARD,
        currentPath: "Gateway",
        donePaths: "Evals & LLM Ops",
      });
    });

    it("writes the provider the vendor's way, with or without a model", async () => {
      getGuidedState.mockResolvedValueOnce({
        ...STATE,
        provider: "vertex_ai",
        providerModel: undefined,
      });
      expect(((await onboardingStateCommand())?.data as { provider: string }).provider).toBe(
        "Vertex AI",
      );
      getGuidedState.mockResolvedValueOnce({ ...STATE, provider: undefined });
      expect("provider" in ((await onboardingStateCommand())?.data as object)).toBe(false);
    });

    it("reads a skipped tour as Skipped and leaves the row out when there was no tour", async () => {
      getGuidedState.mockResolvedValueOnce({
        ...STATE,
        tourSkippedAt: "2026-09-06T10:00:00.000Z",
      });
      expect(((await onboardingStateCommand())?.data as { tour?: string }).tour).toBe(
        "Skipped",
      );
      getGuidedState.mockResolvedValueOnce(STATE);
      const card = (await onboardingStateCommand())?.data as object;
      expect("tour" in card).toBe(false);
      expect(JSON.stringify(card)).not.toContain("none");
    });
  });

  describe("given `langwatch onboarding complete-path llmops` runs", () => {
    /** @scenario "the CLI completes a path by name" */
    it("asks the platform to complete the llmops path and prints the done marker", async () => {
      completePath.mockResolvedValue({
        ...ANSWERED,
        currentPath: undefined,
        donePaths: ["llmops"],
      });
      const log = vi.spyOn(console, "log").mockImplementation(noop);

      const result = await onboardingCompletePathCommand("llmops");

      expect(resolveCredentials).toHaveBeenCalledTimes(1);
      expect(completePath).toHaveBeenCalledWith("llmops");
      expect(result?.data).toEqual({ text: "Evals & LLM Ops set up" });

      result?.table();
      expect(log.mock.calls[0]![0]).toBe("Evals & LLM Ops set up");
    });

    /** @scenario "the complete-path card is one line naming the path" */
    it("carries nothing of the state the platform answered", async () => {
      completePath.mockResolvedValue({ ...ANSWERED, donePaths: ["coding"] });

      const result = await onboardingCompletePathCommand("coding");

      expect(result?.data).toEqual({ text: "Coding Agent Tracking set up" });
      const printed = JSON.stringify(result?.data);
      expect(printed).not.toContain("provider");
      expect(printed).not.toContain("tour");
      expect(printed).not.toContain("langyconv_1");
    });

    it("prints nothing for a path the platform refuses", async () => {
      completePath.mockRejectedValue(new Error("guided_path_unknown"));
      const log = vi.spyOn(console, "log").mockImplementation(noop);

      await expect(onboardingCompletePathCommand("nope")).rejects.toThrow(
        "guided_path_unknown",
      );
      expect(log).not.toHaveBeenCalled();
    });
  });
});

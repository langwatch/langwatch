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

/** What the platform answers: the card fields plus what stays the platform's. */
const ANSWERED = {
  ...STATE,
  tourCompletedAt: "2026-09-06T10:00:00.000Z",
  conversationId: "langyconv_1",
  tourReplays: 2,
};

/** What the card shows for that answer. */
const CARD = { ...STATE, tour: "completed" };

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
    it("keeps the conversation id, the timestamps and the replay count off the card", async () => {
      getGuidedState.mockResolvedValue(ANSWERED);

      const result = await onboardingStateCommand();

      const printed = JSON.stringify(result?.data);
      expect(printed).not.toContain("langyconv_1");
      expect(printed).not.toContain("2026-09-06");
      expect(printed).not.toContain("tourReplays");
      expect(printed).not.toContain("conversationId");
      expect((result?.data as { tour: string }).tour).toBe("completed");
    });

    it("reads a skipped tour and one that never ran", async () => {
      getGuidedState.mockResolvedValueOnce({
        ...STATE,
        tourSkippedAt: "2026-09-06T10:00:00.000Z",
      });
      expect(((await onboardingStateCommand())?.data as { tour: string }).tour).toBe(
        "skipped",
      );
      getGuidedState.mockResolvedValueOnce(STATE);
      expect(((await onboardingStateCommand())?.data as { tour: string }).tour).toBe(
        "none",
      );
    });
  });

  describe("given `langwatch onboarding complete-path llmops` runs", () => {
    /** @scenario "the CLI completes a path by name" */
    it("asks the platform to complete the llmops path and prints the updated state", async () => {
      const done = {
        ...ANSWERED,
        currentPath: undefined,
        donePaths: ["llmops"],
      };
      const doneCard = { ...CARD, donePaths: ["llmops"] };
      delete (doneCard as { currentPath?: string }).currentPath;
      completePath.mockResolvedValue(done);
      const log = vi.spyOn(console, "log").mockImplementation(noop);

      const result = await onboardingCompletePathCommand("llmops");

      expect(resolveCredentials).toHaveBeenCalledTimes(1);
      expect(completePath).toHaveBeenCalledWith("llmops");
      expect(result?.data).toEqual(doneCard);
      expect(JSON.stringify(result?.data)).not.toContain("langyconv_1");

      result?.table();
      expect(JSON.parse(log.mock.calls[0]![0] as string)).toEqual(doneCard);
    });
  });
});

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
      getGuidedState.mockResolvedValue(STATE);
      const log = vi.spyOn(console, "log").mockImplementation(noop);

      const result = await onboardingStateCommand();

      expect(resolveCredentials).toHaveBeenCalledTimes(1);
      expect(
        vi.mocked(resolveCredentials).mock.invocationCallOrder[0]!,
      ).toBeLessThan(getGuidedState.mock.invocationCallOrder[0]!);
      expect(result?.data).toEqual(STATE);

      result?.table();
      expect(JSON.parse(log.mock.calls[0]![0] as string)).toEqual(STATE);
    });
  });

  describe("given `langwatch onboarding complete-path llmops` runs", () => {
    /** @scenario "the CLI completes a path by name" */
    it("asks the platform to complete the llmops path and prints the updated state", async () => {
      const done = { ...STATE, currentPath: undefined, donePaths: ["llmops"] };
      completePath.mockResolvedValue(done);
      const log = vi.spyOn(console, "log").mockImplementation(noop);

      const result = await onboardingCompletePathCommand("llmops");

      expect(resolveCredentials).toHaveBeenCalledTimes(1);
      expect(completePath).toHaveBeenCalledWith("llmops");
      expect(result?.data).toEqual(done);

      result?.table();
      expect(JSON.parse(log.mock.calls[0]![0] as string)).toEqual(done);
    });
  });
});

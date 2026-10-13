/**
 * `instant-eval cancel`, against a mocked service.
 *
 * @see specs/features/instant-eval-cli.feature
 */

import { describe, expect, it, vi } from "vitest";

import {
  ProcessExitError,
  RUN,
  installCommandHarness,
  serviceSpies,
} from "./instant-eval-command-fixtures";

vi.mock("../cli-instant-evals-service", () => ({
  createCliInstantEvalsService: vi.fn(() => serviceSpies),
}));

vi.mock("../../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({
    apiKey: "test-key",
    source: "env",
    endpoint: "https://app.langwatch.ai",
  })),
}));

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
    warn: vi.fn(),
    stop: vi.fn(),
    text: "",
  }),
}));

import { cancelInstantEvalCommand } from "../cancel";

const { cancel: cancelSpy } = serviceSpies;
installCommandHarness();

describe("instant-eval cancel, given a running run", () => {
  describe("when it is cancelled", () => {
    /** @scenario "cancel asks a run to stop" */
    it("asks the platform to stop it", async () => {
      cancelSpy.mockResolvedValue({ ...RUN, status: "cancelled" });

      const result = await cancelInstantEvalCommand("instant_eval_abc");

      expect(cancelSpy).toHaveBeenCalledWith("instant_eval_abc");
      expect((result?.data as { status: string } | undefined)?.status).toBe("cancelled");
    });

    it("exits non-zero when the run already finished", async () => {
      cancelSpy.mockRejectedValue(new Error("instant_eval_already_finished"));

      await expect(cancelInstantEvalCommand("instant_eval_abc")).rejects.toThrow(ProcessExitError);
    });
  });
});

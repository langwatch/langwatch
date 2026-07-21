/**
 * `workflow run` has two things that can throw a `SyntaxError`, and they belong
 * to opposite parties: `JSON.parse(options.input)` is the CALLER's mistake, and
 * `await response.json()` is the SERVER's. They used to share one `try`, whose
 * catch mapped every `SyntaxError` to `--input must be valid JSON` — so a
 * malformed 200-body told the caller to fix an input that was already valid.
 *
 * That is worse than an unhelpful message: it sends the caller (or the agent
 * driving them) to debug the wrong side of the wire, and it is invisible unless
 * the two paths are exercised separately. So they are, here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../utils/apiKey", () => ({ checkApiKey: vi.fn() }));

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
    text: "",
  }),
}));

const failSpinner = vi.fn();
vi.mock("../../../utils/spinnerError", () => ({
  failSpinner: (args: unknown) => failSpinner(args),
}));

const reportCommandError = vi.fn();
vi.mock("../../../utils/errorOutput", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    reportCommandError: (args: unknown) => reportCommandError(args),
  };
});

import { runWorkflowCommand } from "../run";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LANGWATCH_API_KEY = "sk-test";
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new ProcessExitError(code as number);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runWorkflowCommand()", () => {
  describe("when --input is not valid JSON", () => {
    it("blames the input, and never reaches the network", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      await expect(
        runWorkflowCommand("wf_1", { input: "{not json" }),
      ).rejects.toThrow(ProcessExitError);

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(reportCommandError).toHaveBeenCalledOnce();
      const { error } = reportCommandError.mock.calls[0]![0] as { error: Error };
      expect(error.message).toContain("--input must be valid JSON");
    });
  });

  describe("when the server answers 200 with a body that is not JSON", () => {
    it("does not blame --input for the server's malformed reply", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("<html>gateway</html>", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      await expect(
        runWorkflowCommand("wf_1", { input: '{"valid":true}' }),
      ).rejects.toThrow(ProcessExitError);

      expect(reportCommandError).not.toHaveBeenCalled();
      expect(failSpinner).toHaveBeenCalledOnce();
      const { error } = failSpinner.mock.calls[0]![0] as { error: Error };
      expect(error).toBeInstanceOf(SyntaxError);
      expect(error.message).not.toContain("--input");
    });
  });
});

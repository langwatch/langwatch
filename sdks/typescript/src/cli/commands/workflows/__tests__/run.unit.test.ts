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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
        runWorkflowCommand({ id: "wf_1", options: { input: "{not json" } }),
      ).rejects.toThrow(ProcessExitError);

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(reportCommandError).toHaveBeenCalledOnce();
      const { error } = reportCommandError.mock.calls[0]![0] as {
        error: Error;
      };
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
        runWorkflowCommand({
          id: "wf_1",
          options: { input: '{"valid":true}' },
        }),
      ).rejects.toThrow(ProcessExitError);

      expect(reportCommandError).not.toHaveBeenCalled();
      expect(failSpinner).toHaveBeenCalledOnce();
      const { error } = failSpinner.mock.calls[0]![0] as { error: Error };
      expect(error).toBeInstanceOf(SyntaxError);
      expect(error.message).not.toContain("--input");
    });
  });

  const okResponse = (): Response =>
    new Response(JSON.stringify({ output: "done" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  const sentBody = (fetchSpy: ReturnType<typeof vi.spyOn>): unknown =>
    JSON.parse(
      (fetchSpy.mock.calls[0]![1] as { body: string }).body,
    ) as unknown;

  describe("when --param pairs are given", () => {
    /** @scenario "The workflow run command merges param flags into its entry inputs" */
    it("sends each name as an entry input holding the flag's value", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(okResponse());

      await runWorkflowCommand({
        id: "wf_1",
        options: {
          param: ["region=eu-central", "seats=12", "beta=true"],
        },
      });

      expect(sentBody(fetchSpy)).toEqual({
        region: "eu-central",
        seats: 12,
        beta: true,
      });
    });

    it("wins over the same key in --input, and leaves the rest of it alone", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(okResponse());

      await runWorkflowCommand({
        id: "wf_1",
        options: {
          input: '{"region":"us-east","question":"what is 2 + 2?"}',
          param: ["region=eu-central"],
        },
      });

      expect(sentBody(fetchSpy)).toEqual({
        region: "eu-central",
        question: "what is 2 + 2?",
      });
    });
  });

  describe("when only --input is given", () => {
    it("sends exactly the record it parsed, as it always did", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(okResponse());

      await runWorkflowCommand({
        id: "wf_1",
        options: {
          input: '{"region":"us-east","seats":3}',
        },
      });

      expect(sentBody(fetchSpy)).toEqual({ region: "us-east", seats: 3 });
    });
  });
});

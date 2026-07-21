/**
 * What a FAILING command actually puts on stdout, stderr and the exit code.
 *
 * This drives a real command (`trace search` — the one Langy leans on most) with
 * only the API service faked, because the contract being tested is the command's
 * OUTPUT, and a test of the renderer alone would not catch a command that forgot
 * to call it, printed the document to the wrong stream, or exited 0 on failure.
 *
 * Langy runs this CLI over a shell and parses its stdout. If a failure arrives
 * there as prose, the agent cannot tell a transient failure from a terminal one,
 * so it guesses — and the whole typed-error chain degrades to "Something went
 * wrong". The assertions below are that contract.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readCliErrorDocument } from "@langwatch/cli-cards/handled-error";
import type * as TracesApiModule from "@/client-sdk/services/traces/traces-api.service";

vi.mock(
  "@/client-sdk/services/traces/traces-api.service",
  async (importOriginal) => {
    const actual = await importOriginal<typeof TracesApiModule>();
    return { ...actual, TracesApiService: vi.fn() };
  },
);

vi.mock("../../utils/apiKey", () => ({ checkApiKey: vi.fn() }));

const spinnerFail = vi.fn();
vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: spinnerFail,
    warn: vi.fn(),
    text: "",
  }),
}));

import { TracesApiService } from "@/client-sdk/services/traces/traces-api.service";
import { LangWatchHandledError } from "@/internal/api/errors";
import { searchTracesCommand } from "../traces/search";
import { setOutputFormat } from "../../utils/errorOutput";

class ProcessExitError extends Error {
  constructor(public readonly code: number) {
    super(`process.exit(${code})`);
  }
}

const notFound = () =>
  new LangWatchHandledError({
    handled: {
      code: "trace_not_found",
      kind: "trace_not_found",
      message: "Trace not found: trace-abc",
      httpStatus: 404,
      meta: { id: "trace-abc" },
      isHandled: true,
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    },
    body: { error: "trace_not_found", message: "Trace not found: trace-abc" },
    message: "Trace not found: trace-abc",
  });

describe("given a command fails with a domain error", () => {
  let stdout: string[];
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    stdout = [];

    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      stdout.push(args.join(" "));
    });
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new ProcessExitError(code ?? 0);
    }) as never);

    vi.mocked(TracesApiService).mockImplementation(function () {
      return { search: vi.fn().mockRejectedValue(notFound()) };
    } as never);
  });

  afterEach(() => {
    setOutputFormat(undefined);
    vi.restoreAllMocks();
  });

  const run = async (options: { format?: string }) => {
    // The command deliberately reads no format of its own on the error path —
    // the program's preAction hook records it for every invocation. Driving the
    // command directly means playing the hook's part first.
    setOutputFormat(options.format);
    return searchTracesCommand(options).catch((error: unknown) => error);
  };

  describe("when the caller asked for --format json", () => {
    it("prints a structured document on stdout", async () => {
      await run({ format: "json" });

      const parsed = readCliErrorDocument(stdout.join("\n"));
      expect(parsed).not.toBeNull();
    });

    it("gives the machine the kind, the meta and the trace id", async () => {
      await run({ format: "json" });

      expect(readCliErrorDocument(stdout.join("\n"))).toMatchObject({
        kind: "trace_not_found",
        httpStatus: 404,
        meta: { id: "trace-abc" },
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        isHandled: true,
      });
    });

    it("puts nothing but the document on stdout, so the parse cannot trip", () => {
      // The human line goes to stderr via ora, which defaults to that stream.
      return run({ format: "json" }).then(() => {
        expect(() => JSON.parse(stdout.join("\n"))).not.toThrow();
      });
    });

    it("exits non-zero", async () => {
      const error = await run({ format: "json" });

      expect(error).toBeInstanceOf(ProcessExitError);
      expect((error as ProcessExitError).code).toBe(1);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("when the caller asked for no particular format", () => {
    it("prints the human line, naming the failure and its trace id", async () => {
      await run({});

      const rendered = spinnerFail.mock.calls.flat().join("\n");
      expect(rendered).toContain("Trace not found: trace-abc");
      expect(rendered).toContain("trace_not_found");
      expect(rendered).toContain("4bf92f3577b34da6a3ce929d0e0e4736");
    });

    it("keeps stdout clear, so a table-reading caller sees no stray JSON", async () => {
      await run({});

      expect(stdout.join("")).not.toContain('"ok": false');
    });

    it("exits non-zero", async () => {
      const error = await run({});

      expect((error as ProcessExitError).code).toBe(1);
    });
  });
});

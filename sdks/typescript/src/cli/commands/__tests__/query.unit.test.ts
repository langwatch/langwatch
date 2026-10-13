/**
 * `langwatch query "<sql>" -o json` through the REAL command tree (`buildProgram`), like
 * `whoami-json.unit.test.ts`, so the output port's resolution and serialization are exercised.
 * @see specs/typescript-sdk/cli-cross-project-access.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QueryApiError } from "@/client-sdk/services/query/query-api.service";

const queryMock = vi.fn();
vi.mock("@/client-sdk/services/query/query-api.service", async (importOriginal) => {
  const actual = await importOriginal();
  return Object.assign({}, actual, {
    QueryApiService: vi.fn().mockImplementation(function () {
      return { query: queryMock };
    }),
  });
});

vi.mock("../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({
    apiKey: "test-key",
    source: "env",
    endpoint: "https://app.langwatch.ai",
    projectId: undefined,
  })),
}));

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
  }),
}));

// buildProgram() reads the tsup-injected __CLI_VERSION__ build constant, which
// no test runner defines (see program-error-contract.unit.test.ts).
(globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";

const AGENT_ENV = ["CLAUDECODE", "CLAUDE_CODE", "CURSOR_TRACE_ID"];

let stdout: string[] = [];
let stderr: string[] = [];
let exited: number[] = [];
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = Object.fromEntries(AGENT_ENV.map((n) => [n, process.env[n]]));
  for (const name of AGENT_ENV) delete process.env[name];
  stdout = [];
  stderr = [];
  exited = [];
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    stdout.push(String(line));
  });
  vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    stderr.push(String(line));
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  });
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exited.push(code ?? 0);
    // Thrown rather than returned: the real `process.exit` never comes back,
    // and a stub that does lets the command run on past its own refusal and
    // fail on state the exit was there to avoid reaching.
    throw new ProcessExitError(code ?? 0);
  }) as never);
});

afterEach(() => {
  for (const name of AGENT_ENV) {
    const value = savedEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.restoreAllMocks();
});

/** The sentinel the `process.exit` stub throws, so a refusal stops the command. */
class ProcessExitError extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`);
  }
}

const runQuery = async (argv: string[]): Promise<void> => {
  const { buildProgram } = await import("../../program.js");
  const program = buildProgram();
  program.exitOverride();
  try {
    await program.parseAsync(["query", ...argv], { from: "user" });
  } catch (error) {
    if (!(error instanceof ProcessExitError)) throw error;
  }
};

describe("given a QueryApiService that returns rows", () => {
  const RUN_RESULT = {
    columns: [{ name: "count", type: "number" }],
    rows: [{ count: 3 }],
    statistics: { elapsedMs: 12, rowsRead: 3, bytesRead: 128, rowsReturned: 1 },
    followsTimeWindow: true,
    followsGranularity: false,
    diagnostics: [],
  };

  beforeEach(() => {
    queryMock.mockResolvedValue(RUN_RESULT);
  });

  describe("when the user runs langwatch query -o json", () => {
    /** @scenario "langwatch query -o json prints the rows and exits 0" */
    it("posts the sql with no project scoping", async () => {
      await runQuery(["SELECT count(*) AS count", "-o", "json"]);

      expect(queryMock).toHaveBeenCalledWith({ sql: "SELECT count(*) AS count" });
    });

    /** @scenario "langwatch query -o json prints the rows and exits 0" */
    it("prints exactly one JSON array of the returned rows", async () => {
      await runQuery(["SELECT count(*) AS count", "-o", "json"]);

      expect(stdout).toHaveLength(1);
      expect(JSON.parse(stdout[0]!)).toEqual(RUN_RESULT.rows);
    });

    /** @scenario "langwatch query -o json prints the rows and exits 0" */
    it("exits 0", async () => {
      await runQuery(["SELECT count(*) AS count", "-o", "json"]);

      expect(exited).toEqual([]);
    });
  });

  describe("when the user runs langwatch query without a format flag", () => {
    it("renders the rows as a table", async () => {
      await runQuery(["SELECT count(*) AS count"]);

      expect(stdout.join("\n")).toContain("count");
      expect(stdout.join("\n")).toContain("3");
      expect(exited).toEqual([]);
    });
  });
});

describe("given a QueryApiService that refuses the query", () => {
  beforeEach(() => {
    queryMock.mockRejectedValue(
      Object.assign(new QueryApiError("Unknown dataset foo", "run query", undefined, 422), {
        isLangWatchHandledError: true,
        code: "dataset_not_found",
        kind: "validation_error",
        httpStatus: 422,
        meta: { availableDatasets: ["traces", "evaluations"] },
        isHandled: true,
      }),
    );
  });

  describe("when the query is refused by the platform", () => {
    /** @scenario "langwatch query prints a coded error and exits non-zero on failure" */
    it("prints a structured error document naming the code, message and meta", async () => {
      await runQuery(["SELECT * FROM foo", "-o", "json"]);

      expect(stdout).toHaveLength(1);
      const document = JSON.parse(stdout[0]!) as {
        ok: boolean;
        error: { code: string; message: string; meta: Record<string, unknown> };
      };
      expect(document.ok).toBe(false);
      expect(document.error.code).toBe("dataset_not_found");
      expect(document.error.message).toContain("Unknown dataset foo");
      expect(document.error.meta).toMatchObject({
        availableDatasets: ["traces", "evaluations"],
      });
    });

    /** @scenario "langwatch query prints a coded error and exits non-zero on failure" */
    it("exits non-zero", async () => {
      await runQuery(["SELECT * FROM foo", "-o", "json"]);

      expect(exited).toContain(1);
    });
  });
});

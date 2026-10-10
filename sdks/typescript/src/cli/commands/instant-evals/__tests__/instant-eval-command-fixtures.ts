/**
 * What the `instant-eval` command suites share: the mocked service, the runs
 * and judgements it answers with, and the console and exit capture around
 * each test.
 *
 * Not a suite itself: the file has no `.test.ts` suffix so vitest never
 * collects it. Each suite still declares its own `vi.mock` calls, because
 * those are hoisted per test file, and points the service mock at
 * {@link serviceSpies}.
 *
 * @see specs/features/instant-eval-cli.feature
 */

import { afterEach, beforeEach, vi } from "vitest";

import { AGENT_MODE_ENV_VARS } from "../../../utils/output";

/** The service methods every command reaches, as spies the suites program. */
export const serviceSpies = {
  create: vi.fn(),
  estimate: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  results: vi.fn(),
  sample: vi.fn(),
  cancel: vi.fn(),
};

export class ProcessExitError extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`);
  }
}

export const RUN = {
  id: "instant_eval_abc",
  name: null,
  sql: "SELECT\n  TraceId,\n  eval(llm_readable_trace(TraceId, 8000), 'annoyed') AS q1\nFROM analytics.traces",
  parameters: { start_at: "2026-09-11 12:00:00" },
  questions: [
    {
      id: "q1",
      function: "eval",
      kind: "boolean" as const,
      reads: "probability",
      threshold: 0.5,
    },
  ],
  limit: 1_000,
  status: "queued" as const,
  total: null,
  progress: 0,
  matched: null,
  matchedByQuestion: {},
  failed: 0,
  skipped: 0,
  tokens: 0,
  costUsd: 0,
  priceUsd: 0,
  error: null,
  createdAt: "2026-09-18T12:00:00.000Z",
  updatedAt: "2026-09-18T12:00:00.000Z",
  startedAt: null,
  finishedAt: null,
};

/** The same run once it is over, which is what a blocking run answers with. */
export const FINISHED_RUN = {
  ...RUN,
  status: "finished" as const,
  total: 10_000,
  progress: 10_000,
  matched: 412,
  matchedByQuestion: { q1: 412 },
  tokens: 6_100_000,
  costUsd: 0.2562,
  priceUsd: 0.33,
  startedAt: "2026-09-18T12:00:01.000Z",
  finishedAt: "2026-09-18T12:00:21.000Z",
};

export const ESTIMATE = {
  rows: 5_000,
  isRowsCapped: false,
  avgTokens: 900,
  totalTokens: 4_500_000,
  requests: 5_000,
  costUsd: 0.189,
  priceUsd: 0.2457,
};

export const JUDGMENT = {
  traceId: "trace_1",
  questionId: "q1",
  threadId: "thread_1",
  spanId: "",
  kind: "boolean",
  status: "judged" as const,
  passed: true,
  score: null,
  label: null,
  probability: 0.82,
  probabilities: null,
  error: null,
  occurredAt: "2026-09-18T12:00:00.000Z",
};

/**
 * Captures what a command prints and turns `process.exit` into a throw, for
 * the suite that calls it. Returns a reader over everything logged so far.
 */
export function installCommandHarness(): { printed: () => string } {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let savedAgentMode: [string, string | undefined][];

  beforeEach(() => {
    vi.clearAllMocks();
    // Agent mode is detected from the environment, and these suites run inside
    // a coding agent, so the table renderings would never be reached.
    savedAgentMode = AGENT_MODE_ENV_VARS.map((name) => [
      name,
      process.env[name],
    ]);
    for (const name of AGENT_MODE_ENV_VARS) delete process.env[name];
    process.exitCode = undefined;
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new ProcessExitError(code ?? 0);
    }) as never);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    serviceSpies.sample.mockResolvedValue({ rows: [], judgments: [] });
  });

  afterEach(() => {
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    for (const [name, value] of savedAgentMode) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    process.exitCode = undefined;
  });

  return {
    printed: () =>
      logSpy.mock.calls
        .map((call: unknown[]) => call.map(String).join(" "))
        .join("\n"),
  };
}

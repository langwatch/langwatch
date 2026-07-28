/**
 * The console/env capture the output tests share.
 *
 * The port and the format gate both answer through `console.log`,
 * `process.stderr` and `process.exit`, so asserting on either means capturing
 * all three. Both must also run with agent-mode detection OFF: Claude Code sets
 * `CLAUDECODE` unconditionally, so a suite that inherited the ambient
 * environment would assert against agent mode by accident and pass for the
 * wrong reason.
 *
 * Not named `*.test.ts` on purpose — vitest's `include` is `src/**\/*.test.ts`,
 * so this module is imported by the suites rather than collected as one.
 */
import { beforeEach, afterEach, vi } from "vitest";
import { AGENT_MODE_ENV_VARS } from "../output";

export interface OutputHarness {
  /** Lines written to stdout via `console.log`. */
  logged: string[];
  /** Chunks written to stderr. */
  warned: string[];
  /** Exit codes passed to `process.exit`. */
  exited: number[];
}

/**
 * Registers the hooks in the CALLING suite and returns the live buffers.
 *
 * The buffers are emptied in place rather than reassigned, so a caller may
 * destructure them once at module scope and still read what the current test
 * produced.
 */
export const installOutputHarness = (): OutputHarness => {
  const harness: OutputHarness = { logged: [], warned: [], exited: [] };
  let savedAgentEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedAgentEnv = Object.fromEntries(
      AGENT_MODE_ENV_VARS.map((name) => [name, process.env[name]]),
    );
    for (const name of AGENT_MODE_ENV_VARS) delete process.env[name];
    harness.logged.length = 0;
    harness.warned.length = 0;
    harness.exited.length = 0;
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      harness.exited.push(code ?? 0);
      return undefined as never;
    }) as never);
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      harness.logged.push(String(line));
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      harness.warned.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    for (const name of AGENT_MODE_ENV_VARS) {
      const value = savedAgentEnv[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    vi.restoreAllMocks();
  });

  return harness;
};

/**
 * How the CLI journey spawns the built CLI: one temporary working directory, one temporary
 * config path, and credentials that come only from the two environment variables an
 * integrator would set.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CliRunner } from "./cli-runner";

const AGENT_MODE_VARS = [
  "CLAUDECODE",
  "CLAUDE_CODE",
  "CURSOR_AGENT",
  "GITHUB_COPILOT",
  "AMAZON_Q",
  "LW_AGENT_MODE",
  "LANGWATCH_AGENT_MODE",
];

export type CliWorkspace = Readonly<{
  cli: CliRunner;
  dir: string;
  remove: () => void;
}>;

export function cliEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    LANGWATCH_API_KEY: process.env.LANGWATCH_API_KEY,
    LANGWATCH_ENDPOINT: process.env.LANGWATCH_ENDPOINT,
    // The daemon forks itself on a second cache miss and outlives the run.
    LANGWATCH_NO_DAEMON: "1",
    LANGWATCH_DAEMON_NO_SPAWN: "1",
    NO_COLOR: "1",
  };
  for (const name of AGENT_MODE_VARS) env[name] = undefined;
  return { ...env, ...overrides };
}

/** Another runner over a directory that already exists, with its own env. */
export function cliRunnerIn(
  dir: string,
  envOverrides: Record<string, string | undefined> = {},
): CliRunner {
  return new CliRunner({
    cwd: dir,
    env: cliEnv({ LANGWATCH_CLI_CONFIG: join(dir, "config.json"), ...envOverrides }),
  });
}

/** A working directory of its own, so no command can read the repo's files. */
export function cliWorkspace(
  envOverrides: Record<string, string | undefined> = {},
  prefix = "langwatch-cli-journey-",
): CliWorkspace {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const env = cliEnv({
    LANGWATCH_CLI_CONFIG: join(dir, "config.json"),
    ...envOverrides,
  });
  return {
    dir,
    cli: new CliRunner({ cwd: dir, env }),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * The document a command prints under `-o json`, or a named failure. A refusal
 * prints its document and then a human line, so this reads the first complete
 * value rather than the whole of stdout.
 */
export function parseJson<T>(output: string, command: string): T {
  const start = output.search(/[[{]/);
  if (start < 0) throw new Error(`\`${command}\` printed no JSON document:\n${output}`);
  const end = endOfFirstValue(output, start);
  try {
    return JSON.parse(output.slice(start, end)) as T;
  } catch (error) {
    throw new Error(
      `\`${command}\` printed something that is not JSON (${
        error instanceof Error ? error.message : String(error)
      }):\n${output}`,
    );
  }
}

/** Where the JSON value that starts at `start` ends, counting its brackets. */
function endOfFirstValue(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let at = start; at < text.length; at++) {
    const character = text[at];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{" || character === "[") depth += 1;
    else if (character === "}" || character === "]") {
      depth -= 1;
      if (depth === 0) return at + 1;
    }
  }
  return text.length;
}

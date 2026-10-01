#!/usr/bin/env node
// Launcher constants are pinned against the SDK by
// sdks/typescript/src/cli/__tests__/plugin-launcher-contract.unit.test.ts.
import { spawn } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";

// Where the CLI keeps its config, the field it records its own location in,
// and where its session state lives (relative to the config directory).
const CLI_CONFIG = {
  envVar: "LANGWATCH_CLI_CONFIG",
  path: [".langwatch", "config.json"],
  locationField: "cli_location",
  stateDir: ["state", "session-context"],
};

// The CLI command each hook event runs.
const CLI_COMMANDS = {
  "session-context": ["ingest", "hook", "claude-code"],
  "session-guidance": ["ingest", "guidance", "claude-code"],
};

// Claude Code exports these into every hook it runs. Another Agent Plugins
// client that discovered the Claude Code hooks does not, and must run nothing.
const CLAUDE_MARKERS = ["CLAUDECODE", "CLAUDE_CODE_SESSION_ID", "CLAUDE_PROJECT_DIR"];

const NOT_INSTALLED =
  "LangWatch: the langwatch CLI is not installed, so this session's repository and branch are not being recorded. Install it with `npm install -g langwatch`, then run `langwatch login`.";

const configPath = () => process.env[CLI_CONFIG.envVar] || join(homedir(), ...CLI_CONFIG.path);

function recordedCli() {
  try {
    const at = JSON.parse(readFileSync(configPath(), "utf8"))[CLI_CONFIG.locationField];
    if (existsSync(at.node) && existsSync(at.entry)) return [at.node, at.entry];
  } catch {
    // No config, no record, or a record that no longer exists: fall through.
  }
  return null;
}

// A PATH lookup means a file that can be run, not a name that happens to be
// there: a directory called `langwatch`, or a file without the execute bit,
// would be picked and then fail to spawn while the real CLI sat further down
// PATH.
function runnable(candidate) {
  try {
    if (!statSync(candidate).isFile()) return false;
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function cliOnPath() {
  const names = process.platform === "win32" ? ["langwatch.cmd", "langwatch"] : ["langwatch"];
  for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const name of names) {
      if (runnable(join(dir, name))) return [join(dir, name)];
    }
  }
  return null;
}

const readStdin = () =>
  new Promise((resolve) => {
    let raw = "";
    const done = () => resolve(raw);
    setTimeout(done, 1_000).unref();
    process.stdin
      .on("data", (chunk) => (raw += chunk))
      .on("end", done)
      .on("error", done);
  });

// One line, once per session, only where Claude Code reads it as context.
async function notifyNotInstalled() {
  let payload = {};
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    // An unreadable payload names no session start, so nothing is said.
  }
  if (payload.hook_event_name !== "SessionStart") return;
  const session = String(payload.session_id ?? process.env.CLAUDE_CODE_SESSION_ID ?? "");
  const stateDir = join(dirname(configPath()), ...CLI_CONFIG.stateDir);
  const marker = join(stateDir, `plugin-cli-missing-${session.replace(/[^\w.-]/g, "_")}.json`);
  if (existsSync(marker)) return;
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(marker, JSON.stringify({ notified_at: new Date().toISOString() }));
  const output = { hookEventName: "SessionStart", additionalContext: NOT_INSTALLED };
  // Claude Code reads this hook's stdout as its answer to the session, and
  // stdout is a pipe, so the write is asynchronous. Wait for it to reach the
  // pipe before main()'s exit can drop it: the marker above is already on
  // disk, so a notice lost here is never said again.
  await new Promise((resolve) =>
    process.stdout.write(`${JSON.stringify({ hookSpecificOutput: output })}\n`, resolve),
  );
}

async function main() {
  const hook = process.argv[2];
  const command = CLI_COMMANDS[hook];
  if (!command || !CLAUDE_MARKERS.some((name) => (process.env[name] ?? "").trim())) return;
  const cli = recordedCli() ?? cliOnPath();
  if (!cli) {
    if (hook === "session-context") await notifyNotInstalled();
    return;
  }
  const child = spawn(cli[0], [...cli.slice(1), ...command], {
    stdio: "inherit",
    shell: cli[0].endsWith(".cmd"),
  });
  await new Promise((resolve) => child.on("error", resolve).on("close", resolve));
}

// The exit is forced rather than left to the event loop: reading stdin refs
// that handle, and a client that never closes the pipe would otherwise keep
// the hook alive past its answer. Everything written above is drained first.
await main().catch(() => undefined);
process.exit(0);

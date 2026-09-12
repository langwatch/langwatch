#!/usr/bin/env node
// Runs the installed LangWatch CLI for one plugin hook event. The plugin has
// no hook logic of its own: `hooks/hooks.json` runs this file with the event
// name, and this file runs the matching CLI command with the hook's stdin, so
// a hook fix reaches plugin users with the CLI itself.
//
// The CLI is looked up in two places, in order: the node binary and entry
// script the CLI recorded about itself in its config (a Claude Code started
// from a desktop app has a PATH with no version manager on it), then
// `langwatch` on PATH. A recorded path that no longer exists is skipped.
//
// Both CLI commands accept and ignore arguments they do not know and always
// exit zero, and this file exits zero whatever the CLI did, so a plugin from
// any version runs with a CLI from any version and a hook is never why a
// session broke.
//
// This file shares contracts with the CLI, never code: the two constants
// below are pinned against the SDK by
// sdks/typescript/src/cli/__tests__/plugin-launcher-contract.unit.test.ts.
// Importing anything from the SDK here would bring a build step back.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

const configPath = () =>
  process.env[CLI_CONFIG.envVar] || join(homedir(), ...CLI_CONFIG.path);

function recordedCli() {
  try {
    const at = JSON.parse(readFileSync(configPath(), "utf8"))[CLI_CONFIG.locationField];
    if (existsSync(at.node) && existsSync(at.entry)) return [at.node, at.entry];
  } catch {
    // No config, no record, or a record that no longer exists: fall through.
  }
  return null;
}

function cliOnPath() {
  const names = process.platform === "win32" ? ["langwatch.cmd", "langwatch"] : ["langwatch"];
  for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const name of names) {
      if (existsSync(join(dir, name))) return [join(dir, name)];
    }
  }
  return null;
}

const readStdin = () =>
  new Promise((resolve) => {
    let raw = "";
    const done = () => resolve(raw);
    setTimeout(done, 1_000).unref();
    process.stdin.on("data", (chunk) => (raw += chunk)).on("end", done).on("error", done);
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
main()
  .catch(() => undefined)
  .finally(() => process.exit(0));

#!/usr/bin/env bun
/**
 * Protocol smoke test, no real LLM required: spawns the worker with a scratch
 * HOME whose model config points at a DEAD endpoint, then asserts the
 * protocol order on a real pipe:
 *
 *   ready -> pong -> turn_started -> turn_done{outcome:"error"}
 *
 * Usage:
 *   bun run scripts/smoke.ts                          # spawns `node dist/src/main.js` (run `pnpm build` first)
 *   bun run scripts/smoke.ts --bin=./out/langy-worker # spawns a compiled binary
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const binFlag = args.find((a) => a.startsWith("--bin="))?.slice("--bin=".length);

const home = mkdtempSync(join(tmpdir(), "langy-worker-smoke-"));
mkdirSync(join(home, "tmp"), { recursive: true });
writeFileSync(
  join(home, ".langy-worker.json"),
  JSON.stringify({
    model: {
      id: "smoke-model",
      api: "openai-completions",
      baseUrlEnv: "OPENAI_BASE_URL",
      apiKeyEnv: "OPENAI_API_KEY",
      contextWindow: 128000,
      maxTokens: 4096,
    },
    thinkingLevel: "off",
    personaPrompt: "You are the smoke-test persona.",
    agentsFilePath: join(home, "AGENTS.md"),
    sessionDir: join(home, "sessions"),
  }),
);
writeFileSync(join(home, "AGENTS.md"), "# Smoke agents file\n");

const [command, ...commandArgs] = binFlag ? [binFlag] : ["node", "dist/src/main.js"];
const child = spawn(command as string, commandArgs, {
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    HOME: home,
    TMPDIR: join(home, "tmp"),
    // Dead endpoint: connection refused, no LLM ever reached.
    OPENAI_BASE_URL: "http://127.0.0.1:9",
    OPENAI_API_KEY: "smoke-placeholder",
  },
});

const events: Array<Record<string, unknown>> = [];
let buffer = "";
let failed = false;

const deadline = setTimeout(() => {
  console.error("smoke: TIMEOUT after 60s; events so far:", events.map((e) => e.type));
  failed = true;
  child.kill("SIGKILL");
}, 60_000);

child.stderr.on("data", (chunk: Buffer) => {
  process.stderr.write(`[worker stderr] ${chunk}`);
});

// A spawn that never starts emits `error`, not `exit`, so the report and the
// scratch-home cleanup below would never run without this handler.
child.on("error", (error: Error) => {
  clearTimeout(deadline);
  rmSync(home, { recursive: true, force: true });
  console.error("smoke: FAIL", { reason: "spawn failed", command, error: error.message });
  process.exit(1);
});

// A dead child turns every write into an EPIPE `error` event on stdin.
child.stdin.on("error", (error: Error) => {
  console.error(`smoke: stdin write failed: ${error.message}`);
  failed = true;
});

child.stdout.on("data", (chunk: Buffer) => {
  buffer += chunk.toString("utf8");
  let index = buffer.indexOf("\n");
  while (index !== -1) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    index = buffer.indexOf("\n");
    if (line.trim() === "") continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      console.error(`smoke: NON-JSON line on stdout: ${line}`);
      failed = true;
      child.kill("SIGKILL");
      return;
    }
    events.push(event);
    console.error(`[event] ${line.slice(0, 200)}`);
    if (event.type === "ready") {
      child.stdin.write(`${JSON.stringify({ type: "ping" })}\n`);
      child.stdin.write(
        `${JSON.stringify({ type: "turn", turnId: "smoke-1", prompt: "hello", system: "Turn system block." })}\n`,
      );
    }
    if (event.type === "turn_done" || event.type === "handoff") {
      child.stdin.end();
    }
  }
});

child.on("exit", (code) => {
  clearTimeout(deadline);
  const types = events.map((e) => e.type);
  const expectOrder = ["ready", "pong", "turn_started", "turn_done"];
  let cursor = -1;
  const ordered = expectOrder.every((t) => {
    const at = types.indexOf(t, cursor + 1);
    if (at === -1) return false;
    cursor = at;
    return true;
  });
  const terminal = events.find((e) => e.type === "turn_done");
  const terminalOk =
    terminal?.turnId === "smoke-1" && terminal?.outcome === "error";
  const turnEvents = events.filter((e) => e.turnId === "smoke-1");
  const terminalIsLastForTurn =
    turnEvents.length > 0 && turnEvents[turnEvents.length - 1]?.type === "turn_done";
  const readyFirst = types[0] === "ready";

  rmSync(home, { recursive: true, force: true });

  if (failed || !ordered || !terminalOk || !terminalIsLastForTurn || !readyFirst) {
    console.error("smoke: FAIL", {
      code,
      types,
      ordered,
      terminalOk,
      terminalIsLastForTurn,
      readyFirst,
      terminal,
    });
    process.exit(1);
  }
  console.log("smoke: OK", { runtime: binFlag ?? "node dist/src/main.js", types });
  process.exit(0);
});

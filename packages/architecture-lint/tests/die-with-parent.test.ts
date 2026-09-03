/**
 * @vitest-environment node
 *
 * Tests for dev/scripts/die-with-parent.cjs, the hook playwright-mcp.sh loads
 * into the MCP's node process so an orphaned MCP shuts its browser down.
 *
 * Driven as real processes, like the dev-supervisor tests: a stand-in
 * "session" (bash, its own group leader) spawns a stand-in "MCP" (node with
 * the hook) which spawns a stand-in "browser" (sleep). The session is killed
 * by pid, the way a real teardown loses one, and the tests observe who is
 * left.
 *
 * Corresponds to specs/setup/mcp-browser-lifecycle.feature.
 */

import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { asBashWord } from "./shell-quote";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const REPO_ROOT = path.resolve(HERE, "../../..");
const HOOK = path.join(REPO_ROOT, "dev/scripts/die-with-parent.cjs");

const FAST = { LANGWATCH_MCP_ORPHAN_WATCH_MS: "100" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let scratch: string;
let marker: string;
const sessions: number[] = [];

beforeEach(() => {
  scratch = mkdtempSync(path.join(os.tmpdir(), "die-with-parent-test-"));
  marker = `dwp${Math.random().toString(36).slice(2, 10)}`;
});

afterEach(async () => {
  for (const pid of sessions.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    spawnSync("pkill", ["-9", "-f", marker]);
    if (spawnSync("pgrep", ["-f", marker]).status !== 0) break;
    await sleep(50);
  }
  rmSync(scratch, { recursive: true, force: true });
});

/** Every live pid whose command line carries this test's marker. */
function markedPids(): number[] {
  const out = spawnSync("ps", ["-Ao", "pid=", "-o", "command="], {
    encoding: "utf8",
  }).stdout;
  return out
    .split("\n")
    .filter((l) => l.includes(marker) && !l.includes("pkill"))
    .map((l) => Number.parseInt(l.trim(), 10))
    .filter((n) => Number.isInteger(n));
}

async function waitUntil(
  predicate: () => boolean,
  { timeoutMs = 6000 } = {},
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(50);
  }
  return predicate();
}

/**
 * A stand-in session running a stand-in MCP: node with the hook required, a
 * `sleep` child standing for the browser, and an interval keeping it alive
 * the way a server does. Returns the session's pid.
 */
function launchSession(): number {
  const mcp = path.join(scratch, `${marker}-mcp.cjs`);
  writeFileSync(
    mcp,
    `const { spawn } = require("node:child_process");
spawn("sleep", ["120", ${JSON.stringify(marker)}], { stdio: "ignore" });
setInterval(() => {}, 1000);
`,
    "utf8",
  );
  const launcher = path.join(scratch, `${marker}-session.sh`);
  writeFileSync(
    launcher,
    `#!/bin/bash\nnode --require ${asBashWord(HOOK)} ${asBashWord(mcp)} &\nsleep 120\n`,
    "utf8",
  );
  chmodSync(launcher, 0o755);
  const child = spawn("bash", [launcher], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, ...FAST },
  });
  child.unref();
  sessions.push(child.pid as number);
  return child.pid as number;
}

describe("die-with-parent hook", () => {
  describe("given an MCP-shaped process with a child, spawned by a session", () => {
    describe("when the session is killed without signalling anything", () => {
      /** @scenario "The MCP and its browser go down when their session dies" */
      it("shuts the process and its child down", async () => {
        const session = launchSession();
        expect(await waitUntil(() => markedPids().length >= 2)).toBe(true);

        process.kill(session, "SIGKILL");

        expect(await waitUntil(() => markedPids().length === 0)).toBe(true);
      });
    });

    describe("when the session stays alive", () => {
      /** @scenario "A living session keeps its browser" */
      it("signals nothing", async () => {
        launchSession();
        expect(await waitUntil(() => markedPids().length >= 2)).toBe(true);

        await sleep(1000);

        expect(markedPids().length).toBeGreaterThanOrEqual(2);
      });
    });
  });

  describe("given a process that loads the watch and has nothing else to do", () => {
    /** @scenario "The watch never keeps an exiting process alive" */
    it("exits on its own", () => {
      const r = spawnSync(
        "node",
        ["--require", HOOK, "-e", "process.exitCode = 7"],
        { encoding: "utf8", env: { ...process.env, ...FAST }, timeout: 5000 },
      );
      expect(r.status).toBe(7);
    });
  });
});

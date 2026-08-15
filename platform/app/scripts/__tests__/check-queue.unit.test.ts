/**
 * @vitest-environment node
 *
 * Tests for dev/scripts/check-queue.mjs, the machine-wide slot the whole-repo
 * checks (typecheck, lint, format) run under so parallel tsgo and biome runs
 * across worktrees and agents cannot take the machine down.
 *
 * The wrapper is a concurrency mechanism, so it is driven as a real process:
 * every test spawns the actual script against a scratch queue directory and a
 * fake command that timestamps its own start and end into a shared log. Max
 * observed overlap in that log is what "the limit is honored" means.
 *
 * Corresponds to specs/setup/check-slots.feature.
 */

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const QUEUE_SCRIPT = path.join(REPO_ROOT, "dev/scripts/check-queue.mjs");

/**
 * The command the wrapper runs. Appends `start` on boot and `end` after
 * `holdMs`, so the log is enough to reconstruct who ran when and how many ran
 * at once.
 *
 * A test that kills the wrapper mid-hold cannot signal this process, which the
 * kernel hands to init instead. Watching for that reparenting is what stops a
 * long hold from outliving the suite as a sleeping process.
 */
const FAKE_COMMAND = `
const fs = require("node:fs");
const [log, tag, holdMs] = process.argv.slice(2);
const write = (event) =>
  fs.appendFileSync(log, JSON.stringify({ event, tag, at: Date.now() }) + "\\n");
const wrapper = process.ppid;
const orphaned = setInterval(() => {
  if (process.ppid !== wrapper) process.exit(0);
}, 50);
orphaned.unref();
write("start");
setTimeout(() => {
  write("end");
  clearInterval(orphaned);
}, Number(holdMs));
`;

type Event = { event: "start" | "end"; tag: string; at: number };

let scratch: string;
let queueDir: string;
let logFile: string;
let fakeCommand: string;
const running = new Set<ChildProcess>();

beforeEach(() => {
  scratch = mkdtempSync(path.join(os.tmpdir(), "check-queue-test-"));
  queueDir = path.join(scratch, "queue");
  logFile = path.join(scratch, "runs.log");
  fakeCommand = path.join(scratch, "fake-command.cjs");
  writeFileSync(fakeCommand, FAKE_COMMAND, "utf8");
  writeFileSync(logFile, "", "utf8");
});

afterEach(() => {
  for (const child of running) child.kill("SIGKILL");
  running.clear();
  rmSync(scratch, { recursive: true, force: true });
});

type RunOptions = {
  /** How long the fake command holds the slot once it starts. */
  holdMs?: number;
  env?: Record<string, string | undefined>;
  /** Everything after the script path, replacing the fake command. */
  argv?: string[];
};

type Run = {
  child: ChildProcess;
  done: Promise<{ code: number | null; stdout: string; stderr: string }>;
};

function startRun(tag: string, options: RunOptions = {}): Run {
  const argv = options.argv ?? [
    "node",
    fakeCommand,
    logFile,
    tag,
    String(options.holdMs ?? 0),
  ];
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries({
    ...process.env,
    // The queue is machine-wide by design, so every test pins it to a scratch
    // directory. Without this the suite would contend with the developer's own
    // checks (and with itself, across shards).
    CHECK_QUEUE_DIR: queueDir,
    CHECK_SLOTS: "1",
    CHECK_QUEUE_POLL_MS: "25",
    // These tests pin the JS queue. Without this, a developer machine with
    // haven installed would delegate every run to `haven slot run` and the
    // suite would be testing haven instead (see the delegation tests below,
    // which exercise that path deliberately).
    CHECK_QUEUE_IMPL: "js",
    ...options.env,
  })) {
    if (value !== undefined) env[key] = value;
  }

  const child = spawn(process.execPath, [QUEUE_SCRIPT, ...argv], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  running.add(child);

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const done = new Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
  }>((resolve) => {
    // `close`, not `exit`: exit fires when the process ends, while the stdout
    // and stderr pipes may still hold buffered data. The assertions below
    // compare that output exactly, so an early resolve would flake as a queue
    // bug rather than a harness one.
    child.on("close", (code) => {
      running.delete(child);
      resolve({ code, stdout, stderr });
    });
  });
  return { child, done };
}

function readEvents(): Event[] {
  return readFileSync(logFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Event);
}

/** The most runs that were ever inside the command at the same moment. */
function maxOverlap(events: Event[]): number {
  const ordered = [...events].sort(
    (a, b) => a.at - b.at || (a.event === "end" ? -1 : 1),
  );
  let current = 0;
  let peak = 0;
  for (const event of ordered) {
    current += event.event === "start" ? 1 : -1;
    peak = Math.max(peak, current);
  }
  return peak;
}

const startOrder = (events: Event[]) =>
  events.filter((e) => e.event === "start").map((e) => e.tag);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Blocks until the event log shows that some run entered the command. */
async function waitForHolder(): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (startOrder(readEvents()).length > 0) return;
    await sleep(25);
  }
  throw new Error("no run ever took the slot");
}

function queueEntries(): string[] {
  try {
    return readdirSync(queueDir).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
}

describe("check queue", () => {
  describe("given a free slot", () => {
    /** @scenario "A run that finds a free slot is silent" */
    it("runs immediately and says nothing of its own", async () => {
      const run = startRun("solo", { env: { CHECK_SLOTS: "2" } });
      const result = await run.done;

      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
      expect(startOrder(readEvents())).toEqual(["solo"]);
    });

    /** @scenario "A check does not queue behind itself" */
    it("tells everything below it that the slot is already held", async () => {
      // The bin shims mean a queued `pnpm typecheck` spawns another gated
      // entry point. Without this, it queues behind the slot it is holding and
      // waits out the entire maximum wait before starting.
      const run = startRun("nested", {
        argv: ["node", "-e", "process.stdout.write(process.env.CHECK_SLOTS)"],
        env: { CHECK_SLOTS: "3" },
      });
      const result = await run.done;

      expect(result.stdout).toBe("0");
    });

    /** @scenario "The wrapper is transparent to the command it runs" */
    it("passes the command's exit code and output straight through", async () => {
      const run = startRun("passthrough", {
        argv: [
          "node",
          "-e",
          'process.stdout.write("out"); process.stderr.write("err"); process.exit(7)',
        ],
      });
      const result = await run.done;

      expect(result.code).toBe(7);
      expect(result.stdout).toBe("out");
      expect(result.stderr).toBe("err");
    });
  });

  describe("given the limit is already taken", () => {
    /** @scenario "A run past the limit waits and names what it is waiting for" */
    /** @scenario "A run that waited says how long it waited" */
    it("waits, reports what it is queued behind, and reports the wait", async () => {
      const holder = startRun("holder", { holdMs: 700 });
      await waitForHolder();
      const queued = startRun("queued");

      const [, second] = await Promise.all([holder.done, queued.done]);

      expect(second.stderr).toContain("1 check is already active");
      expect(second.stderr).toContain("limit 1");
      expect(second.stderr).toContain("CHECK_SLOTS");
      expect(second.stderr).toContain("Queued at position 1");
      expect(second.stderr).toContain("in the queue, starting now");
      expect(startOrder(readEvents())).toEqual(["holder", "queued"]);
      expect(maxOverlap(readEvents())).toBe(1);
    });

    /** @scenario "Lint and typecheck queue against the same counter" */
    it("makes a lint wait for a typecheck, and wires every check through the queue", async () => {
      const scriptEnv = (script: string) => ({
        npm_package_name: "@langwatch/web",
        npm_lifecycle_event: script,
      });
      const typecheck = startRun("typecheck", {
        holdMs: 700,
        env: scriptEnv("typecheck"),
      });
      await waitForHolder();
      const lint = startRun("lint", { env: scriptEnv("lint") });

      const [, second] = await Promise.all([typecheck.done, lint.done]);

      expect(second.stderr).toContain("1 check is already active");
      expect(startOrder(readEvents())).toEqual(["typecheck", "lint"]);
      expect(maxOverlap(readEvents())).toBe(1);

      // One counter only covers both if both scripts actually route through it.
      const scripts = (
        JSON.parse(
          readFileSync(
            path.join(REPO_ROOT, "platform/app/package.json"),
            "utf8",
          ),
        ) as { scripts: Record<string, string> }
      ).scripts;
      for (const name of [
        "typecheck",
        "typecheck:tests",
        "typecheck:legacy",
        "lint",
        "lint:fix",
        "lint:plugins",
        "format",
      ]) {
        expect(scripts[name], `${name} bypasses the check queue`).toContain(
          "check-queue.mjs",
        );
      }
    });

    /** @scenario "A long wait repeats itself so it never looks hung" */
    it("repeats its position and names the holder while it waits", async () => {
      const holder = startRun("holder", {
        holdMs: 900,
        // A run's label is the package and script pnpm is running, which is
        // what makes one worktree's typecheck distinguishable from another's.
        env: {
          npm_package_name: "@langwatch/web",
          npm_lifecycle_event: "typecheck",
        },
      });
      await waitForHolder();
      const queued = startRun("queued", {
        env: { CHECK_QUEUE_HEARTBEAT_MS: "150" },
      });

      const [, second] = await Promise.all([holder.done, queued.done]);

      expect(second.stderr).toContain("still queued at position 1 after");
      // Named by label and by how long it has held the slot, so a waiter knows
      // which worktree to go look at.
      expect(second.stderr).toMatch(
        /Active: @langwatch\/web typecheck \(.+\) for \d+s/,
      );
    });

    /** @scenario "Waiters are served in arrival order" */
    it("serves the run that queued first", async () => {
      const holder = startRun("holder", { holdMs: 900 });
      await waitForHolder();
      const first = startRun("first");
      await sleep(200);
      const second = startRun("second");

      await Promise.all([holder.done, first.done, second.done]);

      expect(startOrder(readEvents())).toEqual(["holder", "first", "second"]);
    });

    /** @scenario "An explicit limit is honored" */
    it("never runs more than the limit at once", async () => {
      const runs = ["a", "b", "c"].map((tag) => startRun(tag, { holdMs: 150 }));
      await Promise.all(runs.map((run) => run.done));

      expect(startOrder(readEvents())).toHaveLength(3);
      expect(maxOverlap(readEvents())).toBe(1);
    });
  });

  describe("given a slot cannot be released normally", () => {
    /** @scenario "A slot held by a dead process is reclaimed" */
    it("reclaims a slot whose owner was killed", async () => {
      const holder = startRun("killed", { holdMs: 3000 });
      await waitForHolder();
      expect(queueEntries()).toHaveLength(1);
      holder.child.kill("SIGKILL");
      await holder.done;

      const next = startRun("after-kill");
      const result = await next.done;

      expect(result.code).toBe(0);
      expect(startOrder(readEvents())).toContain("after-kill");
      // The killed run never released its entry; the next run pruned it.
      expect(queueEntries()).toHaveLength(0);
    });

    /** @scenario "A run that waits too long runs anyway" */
    it("starts without a slot rather than hanging forever", async () => {
      // The overlap below is only observable while the holder is still inside
      // the command, and the impatient run reaches it only after two node
      // boots and its own maximum wait. The holder is killed as soon as the
      // overlap has been read, so holding far longer than that costs the suite
      // nothing and keeps a loaded machine from ending the holder first, which
      // reads as the queue having serialized the two runs.
      const holder = startRun("holder", { holdMs: 60_000 });
      await waitForHolder();
      // The hold must be wide enough that the run's start and end cannot
      // share a Date.now() millisecond: maxOverlap breaks ties end-first
      // (which "never runs more than the limit" needs), and a same-instant
      // start/end pair would collapse this run's occupancy to nothing.
      const impatient = startRun("impatient", {
        holdMs: 150,
        env: { CHECK_QUEUE_MAX_WAIT_MS: "200" },
      });

      const result = await impatient.done;
      expect(result.stderr).toContain("starting anyway");
      expect(startOrder(readEvents())).toContain("impatient");
      // It really did run alongside the holder rather than after it.
      expect(maxOverlap(readEvents())).toBe(2);

      holder.child.kill("SIGKILL");
      await holder.done;
    });
  });

  describe("given the shared directory is unusable", () => {
    /** @scenario "A malformed entry from another branch cannot crash the queue" */
    it("drops entries whose shape it does not understand", () => {
      mkdirSync(queueDir, { recursive: true });
      // Two entries sharing an arrival millisecond are what force the tie-break
      // comparison, and neither carries the token that comparison reads. This
      // is the shape a worktree on a branch with a different entry format
      // leaves behind, since the directory is machine-wide by design.
      const arrivedAt = Date.now();
      for (const tag of ["one", "two"]) {
        writeFileSync(
          path.join(queueDir, `${arrivedAt}-${tag}.json`),
          JSON.stringify({ pid: process.pid, arrivedAt, state: "waiting" }),
          "utf8",
        );
      }

      const result = spawnSync(
        process.execPath,
        [QUEUE_SCRIPT, "node", fakeCommand, logFile, "after-malformed", "0"],
        {
          env: {
            ...process.env,
            CHECK_QUEUE_DIR: queueDir,
            CHECK_SLOTS: "2",
            CHECK_QUEUE_IMPL: "js",
          },
          encoding: "utf8",
        },
      );

      expect(result.status).toBe(0);
      expect(startOrder(readEvents())).toEqual(["after-malformed"]);
      expect(queueEntries()).toHaveLength(0);
    });

    /** @scenario "A queue that cannot be created degrades to an unqueued run" */
    it("runs the command anyway when the queue directory cannot be written", () => {
      // root ignores the mode bits, so the directory would be writable and
      // there would be nothing to degrade from.
      if (process.getuid?.() === 0) return;
      const readOnly = path.join(scratch, "read-only");
      mkdirSync(readOnly, { mode: 0o500 });

      const result = spawnSync(
        process.execPath,
        [QUEUE_SCRIPT, "node", fakeCommand, logFile, "degraded", "0"],
        {
          env: {
            ...process.env,
            CHECK_QUEUE_DIR: path.join(readOnly, "queue"),
            CHECK_SLOTS: "1",
            CHECK_QUEUE_IMPL: "js",
          },
          encoding: "utf8",
        },
      );

      expect(result.stderr).toContain("queue unavailable");
      expect(result.stderr).toContain("running without a slot");
      expect(result.status).toBe(0);
      expect(startOrder(readEvents())).toEqual(["degraded"]);
    });
  });

  describe("given the queue is turned off", () => {
    /** @scenario "The limit can be turned off" */
    it("runs everything at once and keeps no state", async () => {
      const runs = ["a", "b", "c"].map((tag) =>
        startRun(tag, { holdMs: 300, env: { CHECK_SLOTS: "0" } }),
      );
      const results = await Promise.all(runs.map((run) => run.done));

      expect(maxOverlap(readEvents())).toBe(3);
      for (const result of results) expect(result.stderr).toBe("");
      expect(queueEntries()).toHaveLength(0);
    });
  });

  describe("given no explicit limit", () => {
    /** @scenario "The default limit is derived from the machine" */
    it("bounds the default by both memory and cores, never below one", async () => {
      const run = startRun("explain", {
        argv: ["--explain"],
        env: { CHECK_SLOTS: undefined, CI: undefined },
      });
      const result = await run.done;

      const byMemory = Math.floor(os.totalmem() / (6 * 1024 * 1024 * 1024));
      const byCpu = Math.floor(os.availableParallelism() / 4);
      const expected = Math.max(1, Math.min(byMemory, byCpu));

      expect(result.stderr).toContain(`slots=${expected} source=machine`);
      expect(expected).toBeGreaterThanOrEqual(1);
    });

    /** @scenario "CI does not queue by default" */
    it("does not queue under CI", async () => {
      const explained = await startRun("explain", {
        argv: ["--explain"],
        env: { CHECK_SLOTS: undefined, CI: "true" },
      }).done;
      expect(explained.stderr).toContain("slots=0 source=CI");
      expect(explained.stderr).toContain("queue=off");

      const runs = ["a", "b"].map((tag) =>
        startRun(tag, {
          holdMs: 300,
          env: { CHECK_SLOTS: undefined, CI: "true" },
        }),
      );
      await Promise.all(runs.map((run) => run.done));
      expect(maxOverlap(readEvents())).toBe(2);
    });
  });

  describe("when haven is installed", () => {
    /** A stand-in haven binary that records its argv and exits. */
    function fakeHaven(exitCode: number): { bin: string; argvFile: string } {
      const argvFile = path.join(scratch, "haven-argv.json");
      const bin = path.join(scratch, "haven");
      writeFileSync(
        bin,
        `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(argvFile)}\nexit ${exitCode}\n`,
        { encoding: "utf8", mode: 0o755 },
      );
      return { bin, argvFile };
    }

    /** @scenario "With haven installed the queue runs inside haven" */
    it("hands the run to `haven slot run` and passes its exit code through", async () => {
      const { bin, argvFile } = fakeHaven(7);
      const result = await startRun("delegated", {
        env: { CHECK_QUEUE_IMPL: undefined, HAVEN_BIN: bin },
      }).done;

      expect(result.code).toBe(7);
      const argv = readFileSync(argvFile, "utf8").trim().split("\n");
      expect(argv.slice(0, 2)).toEqual(["slot", "run"]);
      expect(argv).toContain("--");
      // The command reaches haven verbatim, after the `--`.
      expect(argv[argv.indexOf("--") + 1]).toBe("node");
    });

    /** @scenario "Without haven the JavaScript queue still gates" */
    it("falls back to the JS queue when the haven binary does not exist", async () => {
      const result = await startRun("fallback", {
        env: {
          CHECK_QUEUE_IMPL: undefined,
          HAVEN_BIN: path.join(scratch, "no-such-haven"),
        },
      }).done;

      expect(result.code).toBe(0);
      // The run went through the JS queue: it executed the command (the log
      // has its events) rather than dying on the missing binary.
      expect(readEvents().map((e) => e.event)).toEqual(["start", "end"]);
    });

    /** @scenario "The operator can force the JavaScript queue" */
    it("never delegates when CHECK_QUEUE_IMPL is js", async () => {
      const { bin, argvFile } = fakeHaven(7);
      const result = await startRun("forced-js", {
        env: { CHECK_QUEUE_IMPL: "js", HAVEN_BIN: bin },
      }).done;

      expect(result.code).toBe(0);
      expect(() => readFileSync(argvFile, "utf8")).toThrow();
    });
  });
});

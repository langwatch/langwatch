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
  /** Names the run in the shared event log. */
  tag: string;
  /** How long the fake command holds the slot once it starts. */
  holdMs?: number;
  env?: Record<string, string | undefined>;
  /** Everything after the script path, replacing the fake command. */
  argv?: string[];
  /** Give the run its own process group, so a test can signal the group. */
  isDetached?: boolean;
  /** The queue to run, for the tests that need one stalled at a known point. */
  script?: string;
};

type Run = {
  child: ChildProcess;
  done: Promise<{ code: number | null; stdout: string; stderr: string }>;
};

function startRun({
  tag,
  holdMs = 0,
  env: envOverrides,
  argv: argvOverride,
  isDetached = false,
  script = QUEUE_SCRIPT,
}: RunOptions): Run {
  const argv = argvOverride ?? ["node", fakeCommand, logFile, tag, String(holdMs)];
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
    // And they pin the pressure level, because the queue measures the real
    // machine: on a laptop that is genuinely swapping, every derived-limit
    // assertion would flake red. The pressure tests below force their own
    // levels the same way.
    CHECK_PRESSURE: "green",
    // The suite itself often runs inside an agent shell, where a gate-off
    // CHECK_SLOTS is ignored by design. Dropped so every test means what it
    // says; the agent-shell tests below set it back on purpose.
    CLAUDECODE: undefined,
    ...envOverrides,
  })) {
    if (value !== undefined) env[key] = value;
  }

  const child = spawn(process.execPath, [script, ...argv], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: isDetached,
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
  const ordered = [...events].sort((a, b) => a.at - b.at || (a.event === "end" ? -1 : 1));
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
      const run = startRun({ tag: "solo", env: { CHECK_SLOTS: "2" } });
      const result = await run.done;

      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
      expect(startOrder(readEvents())).toEqual(["solo"]);
    });

    /** @scenario "A check does not queue behind itself" */
    it("tells everything below it that the slot is already held", async () => {
      // The bin shims mean a queued `pnpm typecheck` spawns another gated
      // entry point. Without this, it queues behind the slot it is holding and
      // waits out the entire maximum wait before starting. The marker carries
      // the wrapper's own pid, which is what an agent shell verifies.
      const run = startRun({
        tag: "nested",
        argv: [
          "node",
          "-e",
          'process.stdout.write([process.env.CHECK_SLOTS, process.env.CHECK_QUEUE_HELD, String(process.ppid)].join(" "))',
        ],
        env: { CHECK_SLOTS: "3" },
      });
      const result = await run.done;

      const [slots, held, wrapper] = result.stdout.split(" ");
      expect(slots).toBe("0");
      expect(held).toBe(wrapper);
    });

    /** @scenario "The wrapper is transparent to the command it runs" */
    it("passes the command's exit code and output straight through", async () => {
      const run = startRun({
        tag: "passthrough",
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
      const holder = startRun({ tag: "holder", holdMs: 700 });
      await waitForHolder();
      const queued = startRun({ tag: "queued" });

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
      const typecheck = startRun({
        tag: "typecheck",
        holdMs: 700,
        env: scriptEnv("typecheck"),
      });
      await waitForHolder();
      const lint = startRun({ tag: "lint", env: scriptEnv("lint") });

      const [, second] = await Promise.all([typecheck.done, lint.done]);

      expect(second.stderr).toContain("1 check is already active");
      expect(startOrder(readEvents())).toEqual(["typecheck", "lint"]);
      expect(maxOverlap(readEvents())).toBe(1);

      // One counter only covers both if both scripts actually route through it.
      const scripts = (
        JSON.parse(
          readFileSync(path.join(REPO_ROOT, "platform/app/package.json"), "utf8"),
        ) as { scripts: Record<string, string> }
      ).scripts;
      for (const name of [
        "typecheck",
        "typecheck:tests",
        "lint",
        "lint:fix",
        "lint:plugins",
        "format",
      ]) {
        // Named first, because a script that has been renamed or deleted
        // reaches `toContain` as undefined and fails on the argument type
        // rather than on the thing this test is about.
        expect(Object.keys(scripts), `${name} is not a script any more`).toContain(name);
        expect(scripts[name], `${name} bypasses the check queue`).toContain(
          "check-queue.mjs",
        );
      }
    });

    /** @scenario "A long wait repeats itself so it never looks hung" */
    it("repeats its position and names the holder while it waits", async () => {
      const holder = startRun({
        tag: "holder",
        holdMs: 900,
        // A run's label is the package and script pnpm is running, which is
        // what makes one worktree's typecheck distinguishable from another's.
        env: {
          npm_package_name: "@langwatch/web",
          npm_lifecycle_event: "typecheck",
        },
      });
      await waitForHolder();
      const queued = startRun({
        tag: "queued",
        env: { CHECK_QUEUE_HEARTBEAT_MS: "150" },
      });

      const [, second] = await Promise.all([holder.done, queued.done]);

      expect(second.stderr).toContain("still queued at position 1 after");
      // Named by label and by how long it has held the slot, so a waiter knows
      // which worktree to go look at.
      expect(second.stderr).toMatch(/Active: @langwatch\/web typecheck \(.+\) for \d+s/);
    });

    /** @scenario "Waiters are served in arrival order" */
    it("serves the run that queued first", async () => {
      const holder = startRun({ tag: "holder", holdMs: 900 });
      await waitForHolder();
      const first = startRun({ tag: "first" });
      await sleep(200);
      const second = startRun({ tag: "second" });

      await Promise.all([holder.done, first.done, second.done]);

      expect(startOrder(readEvents())).toEqual(["holder", "first", "second"]);
    });

    /** @scenario "An explicit limit is honored" */
    it("never runs more than the limit at once", async () => {
      const runs = ["a", "b", "c"].map((tag) => startRun({ tag, holdMs: 150 }));
      await Promise.all(runs.map((run) => run.done));

      expect(startOrder(readEvents())).toHaveLength(3);
      expect(maxOverlap(readEvents())).toBe(1);
    });
  });

  describe("given a slot cannot be released normally", () => {
    /** @scenario "A slot held by a dead process is reclaimed" */
    it("reclaims a slot whose owner was killed", async () => {
      const holder = startRun({ tag: "killed", holdMs: 3000 });
      await waitForHolder();
      expect(queueEntries()).toHaveLength(1);
      holder.child.kill("SIGKILL");
      await holder.done;

      const next = startRun({ tag: "after-kill" });
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
      const holder = startRun({ tag: "holder", holdMs: 60_000 });
      await waitForHolder();
      // The hold must be wide enough that the run's start and end cannot
      // share a Date.now() millisecond: maxOverlap breaks ties end-first
      // (which "never runs more than the limit" needs), and a same-instant
      // start/end pair would collapse this run's occupancy to nothing.
      const impatient = startRun({
        tag: "impatient",
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
        startRun({ tag, holdMs: 300, env: { CHECK_SLOTS: "0" } }),
      );
      const results = await Promise.all(runs.map((run) => run.done));

      expect(maxOverlap(readEvents())).toBe(3);
      for (const result of results) expect(result.stderr).toBe("");
      expect(queueEntries()).toHaveLength(0);
    });
  });

  describe("given an agent shell", () => {
    /** @scenario "An agent shell cannot turn the queue off" */
    it("ignores a gate-off, says so, and queues like everyone else", async () => {
      const holder = startRun({ tag: "holder", holdMs: 700 });
      await waitForHolder();
      // Red narrows the derived limit to one, so the refusal is observable as
      // real queueing rather than a message alone.
      const agent = startRun({
        tag: "agent",
        env: {
          CLAUDECODE: "1",
          CHECK_SLOTS: "0",
          CI: undefined,
          CHECK_PRESSURE: "red",
        },
      });
      const [, second] = await Promise.all([holder.done, agent.done]);

      expect(second.stderr).toContain(
        "CHECK_SLOTS=0 is ignored in an agent shell",
      );
      expect(second.stderr).toContain("Only a person may turn the queue off");
      expect(second.stderr).toContain("1 check is already active");
      expect(maxOverlap(readEvents())).toBe(1);
    });

    /** @scenario "A run the queue spawned itself stays unqueued in an agent shell" */
    it("keeps the queue's own nested runs unqueued", async () => {
      // A queued `pnpm typecheck` reaches a bin shim, which is another gated
      // entry point running under the wrapper's CHECK_SLOTS=0 and marker. In
      // an agent shell the marker is what carries the gate-off through.
      const run = startRun({
        tag: "outer",
        argv: [
          "node",
          QUEUE_SCRIPT,
          "node",
          fakeCommand,
          logFile,
          "inner",
          "0",
        ],
        // Bounds the failure mode: a regression here queues the inner run
        // behind the outer's held slot, and "starting anyway" breaks the
        // silence assertion instead of hanging the suite for the default wait.
        env: { CLAUDECODE: "1", CHECK_QUEUE_MAX_WAIT_MS: "3000" },
      });
      const result = await run.done;

      expect(result.code).toBe(0);
      // Silent end to end: the outer run found a free slot, and the inner one
      // was neither refused nor queued.
      expect(result.stderr).toBe("");
      expect(startOrder(readEvents())).toEqual(["inner"]);
    });

    /** @scenario "An agent's own shell is not a queue wrapper" */
    it("rejects a held-marker naming an ancestor that is not a queue wrapper", async () => {
      // The test runner is a real live ancestor of the run below, and it is
      // not the queue. `CHECK_QUEUE_HELD=$$` from an agent shell has exactly
      // this shape, and it is the cheapest bypass there is, so it must fail.
      const explained = await startRun({
        tag: "not-the-queue",
        argv: ["--explain"],
        env: {
          CLAUDECODE: "1",
          CHECK_SLOTS: "0",
          CHECK_QUEUE_HELD: String(process.pid),
          CI: undefined,
        },
      }).done;

      expect(explained.stderr).toContain("ignored in an agent shell");
      expect(explained.stderr).not.toContain("source=held");
    });

    /** @scenario "A borrowed held-marker does not turn the queue off" */
    it("rejects a held-marker naming a live process that is not an ancestor", async () => {
      const bystander = spawn("sleep", ["30"]);
      try {
        const explained = await startRun({
          tag: "borrowed",
          argv: ["--explain"],
          env: {
            CLAUDECODE: "1",
            CHECK_SLOTS: "0",
            CHECK_QUEUE_HELD: String(bystander.pid),
            CI: undefined,
          },
        }).done;

        expect(explained.stderr).toContain("ignored in an agent shell");
        expect(explained.stderr).not.toContain("source=held");
      } finally {
        bystander.kill("SIGKILL");
      }
    });
  });

  describe("given no explicit limit", () => {
    /** @scenario "The default limit is derived from the machine" */
    it("bounds the default by both memory and cores, never below one", async () => {
      const run = startRun({
        tag: "explain",
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

    /** @scenario "Memory pressure narrows the queue to one run" */
    it("narrows the derived limit to one under pressure", async () => {
      const result = await startRun({
        tag: "explain",
        argv: ["--explain"],
        env: { CHECK_SLOTS: undefined, CI: undefined, CHECK_PRESSURE: "red" },
      }).done;

      expect(result.stderr).toContain("slots=1 source=pressure");
      expect(result.stderr).toContain("pressure=red");
    });

    it("lets an explicit CHECK_SLOTS win over pressure", async () => {
      const result = await startRun({
        tag: "explain",
        argv: ["--explain"],
        env: { CHECK_SLOTS: "3", CI: undefined, CHECK_PRESSURE: "red" },
      }).done;

      expect(result.stderr).toContain("slots=3 source=CHECK_SLOTS");
    });

    /** @scenario "CI does not queue by default" */
    it("does not queue under CI", async () => {
      const explained = await startRun({
        tag: "explain",
        argv: ["--explain"],
        env: { CHECK_SLOTS: undefined, CI: "true" },
      }).done;
      expect(explained.stderr).toContain("slots=0 source=CI");
      expect(explained.stderr).toContain("queue=off");

      const runs = ["a", "b"].map((tag) =>
        startRun({
          tag,
          holdMs: 300,
          env: { CHECK_SLOTS: undefined, CI: "true" },
        }),
      );
      await Promise.all(runs.map((run) => run.done));
      expect(maxOverlap(readEvents())).toBe(2);
    });

    /** @scenario "CI keeps the runtime limits it had before the pressure policy" */
    it("reads green under CI whatever the machine measures", async () => {
      const explained = await startRun({
        tag: "ci-pressure",
        argv: ["--explain"],
        // No forced level: this is the measured path, which CI short-circuits.
        env: { CHECK_SLOTS: undefined, CI: "true", CHECK_PRESSURE: undefined },
      }).done;

      expect(explained.stderr).toContain("pressure=green");
      // Green sets no GOMAXPROCS at all, so the line is absent entirely.
      expect(explained.stderr).not.toContain("gomaxprocs=");
    });

    it("still lets an explicit level through under CI", async () => {
      const explained = await startRun({
        tag: "ci-forced",
        argv: ["--explain"],
        env: { CHECK_SLOTS: undefined, CI: "true", CHECK_PRESSURE: "red" },
      }).done;

      expect(explained.stderr).toContain("pressure=red");
      expect(explained.stderr).toContain("slots=0 source=CI");
    });
  });

  describe("given the machine is under memory pressure", () => {
    /** Dumps the environment the wrapper hands the command it runs. */
    function envDumper(): { script: string; out: string } {
      const out = path.join(scratch, "child-env.json");
      const script = path.join(scratch, "dump-env.cjs");
      writeFileSync(
        script,
        [
          'const fs = require("node:fs");',
          "const [target] = process.argv.slice(2);",
          "fs.writeFileSync(target, JSON.stringify({",
          "  GOMEMLIMIT: process.env.GOMEMLIMIT ?? null,",
          "  GOMAXPROCS: process.env.GOMAXPROCS ?? null,",
          "}));",
          "",
        ].join("\n"),
        "utf8",
      );
      return { script, out };
    }

    /** @scenario "Memory pressure lowers the memory ceiling to the floor" */
    /** @scenario "Memory pressure halves the compiler's parallelism" */
    it("hands the command the floor and half the cores", async () => {
      const { script, out } = envDumper();
      const result = await startRun({
        tag: "pressured",
        argv: ["node", script, out],
        env: {
          CHECK_PRESSURE: "red",
          GOMEMLIMIT: undefined,
          GOMAXPROCS: undefined,
        },
      }).done;

      expect(result.code).toBe(0);
      const child = JSON.parse(readFileSync(out, "utf8"));
      expect(child.GOMEMLIMIT).toBe("3GiB");
      const cpus = os.availableParallelism();
      expect(child.GOMAXPROCS).toBe(String(Math.max(2, Math.floor(cpus / 2))));
    });

    it("leaves the parallelism alone on a green machine", async () => {
      const { script, out } = envDumper();
      const result = await startRun({
        tag: "green",
        argv: ["node", script, out],
        env: {
          CHECK_PRESSURE: "green",
          GOMEMLIMIT: undefined,
          GOMAXPROCS: undefined,
        },
      }).done;

      expect(result.code).toBe(0);
      const child = JSON.parse(readFileSync(out, "utf8"));
      expect(child.GOMEMLIMIT).toMatch(/GiB$/);
      expect(child.GOMEMLIMIT).not.toBe(null);
      expect(child.GOMAXPROCS).toBe(null);
    });

    it("lets an operator's explicit settings through unchanged", async () => {
      const { script, out } = envDumper();
      const result = await startRun({
        tag: "operator",
        argv: ["node", script, out],
        env: { CHECK_PRESSURE: "red", GOMEMLIMIT: "8GiB", GOMAXPROCS: "9" },
      }).done;

      expect(result.code).toBe(0);
      const child = JSON.parse(readFileSync(out, "utf8"));
      expect(child.GOMEMLIMIT).toBe("8GiB");
      expect(child.GOMAXPROCS).toBe("9");
    });
  });

  describe("given a run is killed from outside the queue", () => {
    /** @scenario "A run killed from outside is reported as not the queue's doing" */
    it("says the queue never kills and names the wrong fix", async () => {
      const result = await startRun({
        tag: "killed",
        argv: ["sh", "-c", "kill -KILL $$"],
      }).done;

      expect(result.code).toBe(137);
      expect(result.stderr).toContain("killed from outside by SIGKILL");
      expect(result.stderr).toContain("never kills");
      expect(result.stderr).toContain("Do not set CHECK_SLOTS=0");
    });

    /** @scenario "A signal delivered to the whole process group still counts as forwarded" */
    it("says nothing when the whole process group is signalled", async () => {
      // What a Ctrl-C at a terminal does: the wrapper and the command receive
      // the signal together, so the command can be gone before the wrapper has
      // handled its own copy. Reading the record too early accuses the operator
      // of an outside kill for their own interrupt.
      const run = startRun({ tag: "group", holdMs: 5000, isDetached: true });
      await waitForHolder();
      // Never negate a missing pid: -0 reaches process.kill as 0, which signals
      // the caller's own process group, and the caller here is the test runner.
      const group = run.child.pid;
      if (!group) throw new Error("the detached run reported no pid to signal");
      process.kill(-group, "SIGTERM");
      const result = await run.done;

      expect(result.stderr).not.toContain("killed from outside");
    });

    it("says nothing about a signal the wrapper itself forwarded", async () => {
      const run = startRun({ tag: "interrupted", holdMs: 5000 });
      await waitForHolder();
      run.child.kill("SIGTERM");
      const result = await run.done;

      expect(result.stderr).not.toContain("killed from outside");
    });

    /**
     * The command that ignores a forwarded SIGTERM, so the signal that finally
     * ends it is one nobody forwarded. It publishes its own pid, because the
     * test has to reach past the wrapper to kill it.
     */
    function ignoresTermArgv(pidFile: string): string[] {
      return ["sh", "-c", `trap '' TERM; echo $$ > ${pidFile}; exec sleep 5`];
    }

    async function waitForPid(pidFile: string): Promise<string> {
      let pid = "";
      for (let attempt = 0; attempt < 200 && pid === ""; attempt++) {
        try {
          pid = readFileSync(pidFile, "utf8").trim();
        } catch {
          // Not created yet.
        }
        // The redirection creates the file before the shell writes the pid into
        // it, so an empty read is as much "not ready" as a missing file. Waiting
        // on both is what keeps the attempts from burning off in microseconds.
        if (pid === "") await sleep(25);
      }
      if (pid === "") throw new Error("the command never published its pid");
      return pid;
    }

    /** @scenario "An interrupted run killed from outside is still reported" */
    it("still names the kill when an interrupt came first", async () => {
      const pidFile = path.join(scratch, "escalated.pid");
      const run = startRun({
        tag: "escalated",
        argv: ignoresTermArgv(pidFile),
      });
      const pid = await waitForPid(pidFile);

      run.child.kill("SIGTERM");
      await sleep(100);
      process.kill(Number(pid), "SIGKILL");
      const result = await run.done;

      expect(result.code).toBe(137);
      expect(result.stderr).toContain("killed from outside by SIGKILL");
    });

    /**
     * A copy of the queue that stops for `stallMs` at one exact point: the
     * moment the child exists.
     *
     * The interrupt this pins is a scheduling race, so no arrangement of real
     * timing reproduces it on demand. A delay is the one edit that cannot
     * change what a program does, only when it does it, so injecting one is
     * what turns the race into a decision the test can make.
     */
    function queueStalledAsCommandAppears(stallMs: number): string {
      const source = readFileSync(QUEUE_SCRIPT, "utf8");
      const call = source.indexOf("spawn(commandArgv[0]");
      const end = source.indexOf("});", call);
      if (call === -1 || end === -1) {
        throw new Error(
          "the queue no longer spawns the command the way this test stalls it",
        );
      }
      const at = end + "});".length;
      const copy = path.join(scratch, "check-queue-stalled.mjs");
      writeFileSync(
        copy,
        `${source.slice(0, at)}\n{ const until = Date.now() + ${stallMs}; while (Date.now() < until) {} }\n${source.slice(at)}`,
        "utf8",
      );
      return copy;
    }

    /** @scenario "An interrupt that arrives as the command starts is forwarded" */
    it("forwards an interrupt that lands in the instant the command appears", async () => {
      const pidFile = path.join(scratch, "stalled.pid");
      const run = startRun({
        tag: "stalled",
        script: queueStalledAsCommandAppears(400),
        argv: ignoresTermArgv(pidFile),
      });
      // Published from inside the stall, so the interrupt below is delivered
      // while the wrapper is still held there.
      const pid = await waitForPid(pidFile);

      run.child.kill("SIGTERM");
      await sleep(100);
      process.kill(Number(pid), "SIGKILL");
      const result = await run.done;

      // A wrapper that took the interrupt on its default disposition would be
      // dead by now, reporting no code and leaving the command behind.
      expect(result.code).toBe(137);
      expect(result.stderr).toContain("killed from outside by SIGKILL");
    });

    it("says nothing about a clean failure", async () => {
      const result = await startRun({
        tag: "failing",
        argv: ["sh", "-c", "exit 7"],
      }).done;

      expect(result.code).toBe(7);
      expect(result.stderr).not.toContain("killed from outside");
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
      const result = await startRun({
        tag: "delegated",
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
      const result = await startRun({
        tag: "fallback",
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
      const result = await startRun({
        tag: "forced-js",
        env: { CHECK_QUEUE_IMPL: "js", HAVEN_BIN: bin },
      }).done;

      expect(result.code).toBe(0);
      expect(() => readFileSync(argvFile, "utf8")).toThrow();
    });
  });
});

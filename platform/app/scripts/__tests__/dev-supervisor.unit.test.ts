/**
 * @vitest-environment node
 *
 * Tests for dev/scripts/dev-supervisor.mjs, which takes a dev stack down with
 * whoever started it so abandoned `pnpm dev` stacks stop accumulating.
 *
 * Driven as real processes, because the thing under test is process-group
 * behaviour and nothing else would exercise it: each test launches a stand-in
 * stack from a detached launcher shell (its own process-group leader, the same
 * shape as an agent's shell or a `sh -c`), kills the launcher by pid the way
 * the real leak happens, and then observes which processes are left.
 *
 * Corresponds to specs/setup/dev-stack-lifecycle.feature.
 */

import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { asBashWord } from "./shell-quote";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const SUPERVISOR = path.join(REPO_ROOT, "dev/scripts/dev-supervisor.mjs");

/** Fast enough that a test never waits on the production 1s cadence. */
const FAST = { LANGWATCH_DEV_WATCH_MS: "100", LANGWATCH_DEV_GRACE_MS: "500" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let scratch: string;
let marker: string;
const launchers: number[] = [];

beforeEach(() => {
  scratch = mkdtempSync(path.join(os.tmpdir(), "dev-supervisor-test-"));
  // Unique per test so one test's leftovers can never be counted by another.
  marker = `devsup${Math.random().toString(36).slice(2, 10)}`;
});

afterEach(async () => {
  for (const pid of launchers.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone, which is what most of these tests assert.
    }
  }
  // These tests count processes by name, so nothing from this one may still be
  // dying when the next starts, and a stack that restarts its own lanes needs
  // more than one pass to go quiet.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    spawnSync("pkill", ["-9", "-f", marker]);
    if (spawnSync("pgrep", ["-f", marker]).status !== 0) break;
    await sleep(50);
  }
  rmSync(scratch, { recursive: true, force: true });
});

const readyFile = () => path.join(scratch, "stack-is-up");

/**
 * A stand-in stack. It touches a readiness file first, which is what the tests
 * wait on: counting marker processes is not enough, because the launcher's own
 * command line carries the marker too, so a count-based wait can be satisfied
 * before the supervisor has even read the group it has to watch. Killing the
 * launcher in that window leaves nothing to watch and the stack runs
 * unsupervised, which is correct behaviour and a useless test.
 */
function writeStack(body: string): string {
  const file = path.join(scratch, `${marker}-stack.sh`);
  writeFileSync(file, `#!/bin/bash\ntouch ${asBashWord(readyFile())}\n${body}\n`, "utf8");
  chmodSync(file, 0o755);
  return file;
}

/** Resolves once the stack is genuinely running under the supervisor. */
const stackIsUp = () => waitUntil(() => existsSync(readyFile()));

/** The shape that leaks: vite, tsx and `go run` are each several deep. */
const DEEP_STACK = `
sleep 120 &
( sleep 120 & wait ) &
echo up
wait
`;

/**
 * The real `pnpm dev`, in miniature. `start.sh` runs
 * `concurrently --restart-tries -1`, so SIGTERM kills the lanes and
 * concurrently immediately starts new ones, while the direct child (pnpm
 * start) exits promptly. A supervisor that treats its own child exiting as
 * "the stack is down" walks away here and leaves the respawned lanes holding
 * the ports, which is exactly what a real stack did.
 */
const RESTARTING_STACK = `
(
  trap '' TERM
  while true; do
    sleep 120 &
    wait $! 2>/dev/null
  done
) &
trap 'exit 0' TERM
echo up
wait
`;

/**
 * Runs `command` from a detached shell, so the shell is its own process-group
 * leader exactly like the launcher in the real leak. Returns the launcher pid.
 *
 * The command goes through a file rather than `sh -c`, so no path built from
 * the environment is ever spliced into a shell command line.
 */
function launchFrom(command: string, env: Record<string, string> = {}): number {
  const file = path.join(scratch, `${marker}-launcher.sh`);
  writeFileSync(file, `#!/bin/bash\n${command}\nsleep 120\n`, "utf8");
  chmodSync(file, 0o755);

  const child = spawn("bash", [file], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, ...FAST, ...env },
  });
  child.unref();
  launchers.push(child.pid as number);
  return child.pid as number;
}

/** How a sentinel is told from a supervisor: it re-enters behind this flag. */
const SENTINEL_FLAG = "--sentinel";

/** The live pids whose command line carries this test's marker and passes `keep`. */
function markedPids(keep: (line: string) => boolean): number[] {
  const out = spawnSync("ps", ["-Ao", "pid=", "-o", "command="], {
    encoding: "utf8",
  }).stdout;
  return out
    .split("\n")
    .filter((l) => l.includes(marker) && !l.includes("pkill") && keep(l))
    .map((l) => Number.parseInt(l.trim(), 10))
    .filter((n) => Number.isInteger(n));
}

/** Every live pid whose command line carries this test's marker. */
function stackPids(): number[] {
  return markedPids(() => true);
}

/**
 * The sentinels posted for this test's stack. A sentinel carries the guarded
 * command in its argv, so the marker tells this test's sentinels from the ones
 * any other run posted.
 */
function sentinelPids(): number[] {
  return markedPids(
    (l) => l.includes("dev-supervisor.mjs") && l.includes(SENTINEL_FLAG),
  );
}

/** Every live pid, with its parent, as `ps` reports them. */
function processTree(): { pid: number; ppid: number; command: string }[] {
  const out = spawnSync(
    "ps",
    ["-Ao", "pid=", "-o", "ppid=", "-o", "command="],
    {
      encoding: "utf8",
    },
  ).stdout;
  const rows: { pid: number; ppid: number; command: string }[] = [];
  for (const line of out.split("\n")) {
    const match = /^(\d+)\s+(\d+)\s+(.*)$/.exec(line.trim());
    if (match === null) continue;
    const [, pid, ppid, command] = match;
    if (pid === undefined || ppid === undefined || command === undefined) {
      continue;
    }
    rows.push({
      pid: Number.parseInt(pid, 10),
      ppid: Number.parseInt(ppid, 10),
      command,
    });
  }
  return rows;
}

/** Whether a pid still exists, for the launcher this test must not disturb. */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
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
 * Runs the supervisor as its own process-group leader, which is the shape an
 * interactive shell produces: there is no separate leader above it to watch,
 * and the tty already sends SIGHUP to the whole job. `spawnSync` cannot do this
 * (it has no `detached`), so this has to be the async spawn.
 */
function runAsGroupLeader(
  args: string[],
): Promise<{ stdout: string; status: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SUPERVISOR, ...args], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...FAST },
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("close", (status) => resolve({ stdout, status }));
  });
}

/** Runs the supervisor in the foreground and collects its result. */
function runSupervised(
  args: string[],
  env: Record<string, string> = {},
  { supervisor = SUPERVISOR }: { supervisor?: string } = {},
): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync(process.execPath, [supervisor, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...FAST, ...env },
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

/**
 * A copy of the supervisor with one string replaced, for the failures that
 * cannot be provoked from the outside: a sentinel that will not spawn, or one
 * that comes up and names no stack. The copy is the real script otherwise, and
 * it imports nothing but node builtins, so it runs anywhere.
 */
function supervisorWith(from: string, to: string): string {
  const source = readFileSync(SUPERVISOR, "utf8");
  if (!source.includes(from)) {
    throw new Error(`dev-supervisor.mjs no longer contains ${from}`);
  }
  const file = path.join(scratch, `${marker}-supervisor.mjs`);
  writeFileSync(file, source.replace(from, to), "utf8");
  return file;
}

describe("dev stack supervisor", () => {
  describe("given a command that runs and exits", () => {
    describe("when it is run through the supervisor", () => {
      /** @scenario "A supervised command is indistinguishable from an unsupervised one" */
      it("passes stdout, stderr and exit code through and says nothing itself", () => {
        const result = runSupervised([
          "sh",
          "-c",
          `echo ${marker}-out; echo ${marker}-err >&2; exit 3`,
        ]);

        expect(result.stdout).toBe(`${marker}-out\n`);
        expect(result.stderr).toBe(`${marker}-err\n`);
        expect(result.status).toBe(3);
      });

      /** @scenario "A stack that exits on its own is not waited on" */
      it("exits as soon as the command does, without waiting for its launcher", () => {
        const started = Date.now();
        const result = runSupervised(["sh", "-c", "exit 0"]);

        expect(result.status).toBe(0);
        expect(Date.now() - started).toBeLessThan(5000);
      });
    });
  });

  describe("given a stack launched from a shell that is then killed", () => {
    describe("when the launcher dies without signalling anything else", () => {
      /** @scenario "The stack goes down when the process that launched it dies" */
      /** @scenario "Every lane goes down, not just the direct child" */
      it("takes down every lane, however deep", async () => {
        const stack = writeStack(DEEP_STACK);
        const launcher = launchFrom(
          `node ${asBashWord(SUPERVISOR)} ${asBashWord(stack)}`,
        );

        expect(await stackIsUp()).toBe(true);
        const before = stackPids().length;

        process.kill(launcher, "SIGKILL");

        expect(await waitUntil(() => stackPids().length === 0)).toBe(true);
        expect(before).toBeGreaterThanOrEqual(3);
      });

      /** @scenario "A stack that restarts its own lanes is still taken down" */
      it("takes down lanes that are restarted while it is stopping them", async () => {
        const stack = writeStack(RESTARTING_STACK);
        const launcher = launchFrom(
          `node ${asBashWord(SUPERVISOR)} ${asBashWord(stack)}`,
        );

        expect(await stackIsUp()).toBe(true);
        process.kill(launcher, "SIGKILL");

        // The direct child exits on SIGTERM straight away. Everything else in
        // the group keeps respawning until the takedown escalates.
        expect(await waitUntil(() => stackPids().length === 0)).toBe(true);
      });

      /** @scenario "A command that outlives its supervisor is still supervised" */
      it("kills outright what ignores the first signal", async () => {
        const stack = writeStack(`trap '' TERM\nsleep 120 &\necho up\nwait`);
        const launcher = launchFrom(
          `node ${asBashWord(SUPERVISOR)} ${asBashWord(stack)}`,
        );

        expect(await stackIsUp()).toBe(true);
        process.kill(launcher, "SIGKILL");

        // SIGTERM is trapped and ignored, so only the grace-period SIGKILL ends it.
        expect(await waitUntil(() => stackPids().length === 0)).toBe(true);
      });

      /** @scenario "The supervisor takes down only what it started" */
      it("leaves other work in the launcher's group alone", async () => {
        const stack = writeStack(DEEP_STACK);
        // A bystander in the launcher's own process group, not ours to kill.
        const bystanderFile = path.join(scratch, `${marker}-bystander.sh`);
        writeFileSync(bystanderFile, "#!/bin/bash\nsleep 120\n", "utf8");
        chmodSync(bystanderFile, 0o755);

        const launcher = launchFrom(
          `${asBashWord(bystanderFile)} & node ${asBashWord(SUPERVISOR)} ${asBashWord(stack)}`,
        );
        expect(await stackIsUp()).toBe(true);

        process.kill(launcher, "SIGKILL");
        await sleep(1500);

        const survivors = spawnSync("ps", ["-Ao", "pid=", "-o", "command="], {
          encoding: "utf8",
        })
          .stdout.split("\n")
          .filter((l) => l.includes(`${marker}-bystander`));
        expect(survivors.length).toBeGreaterThan(0);
      });
    });

    describe("when the supervisor is interrupted", () => {
      /** @scenario "Ctrl-C still stops the stack" */
      it("takes the whole stack down, not just the top of it", async () => {
        const stack = writeStack(DEEP_STACK);
        const supervisor = spawn(process.execPath, [SUPERVISOR, stack], {
          stdio: "ignore",
          env: { ...process.env, ...FAST },
        });

        expect(await stackIsUp()).toBe(true);
        process.kill(supervisor.pid as number, "SIGINT");

        expect(await waitUntil(() => stackPids().length === 0)).toBe(true);
      });
    });
  });

  describe("given a stack whose supervisor is killed outright", () => {
    /**
     * The supervisor's pid, found by its command line: it carries this test's
     * marker (the stack path is its argument) and is not the sentinel. The
     * launcher does not match, because ps shows its argv (`bash .../launcher.sh`),
     * not the script body that mentions the supervisor.
     */
    function supervisorPid(): number | null {
      const [pid] = markedPids(
        (l) => l.includes("dev-supervisor.mjs") && !l.includes(SENTINEL_FLAG),
      );
      return pid ?? null;
    }

    describe("when the supervisor and the shell are both killed by pid", () => {
      /** @scenario "The stack goes down even when the supervisor is killed outright" */
      it("still takes the whole stack down, sentinel included", async () => {
        const stack = writeStack(DEEP_STACK);
        const launcher = launchFrom(
          `node ${asBashWord(SUPERVISOR)} ${asBashWord(stack)}`,
        );
        expect(await stackIsUp()).toBe(true);
        await waitUntil(() => supervisorPid() !== null);
        const supervisor = supervisorPid();
        expect(supervisor).not.toBeNull();

        // The shape of a hard session teardown: the launching group dies to
        // SIGKILL, so no signal ever reaches the detached stack group.
        process.kill(supervisor as number, "SIGKILL");
        process.kill(launcher, "SIGKILL");

        // stackPids counts the sentinel too (the guarded command is in its
        // argv), so reaching zero also means the sentinel did not linger.
        expect(await waitUntil(() => stackPids().length === 0)).toBe(true);
      });
    });

    describe("when only the supervisor is killed", () => {
      /** @scenario "A killed supervisor alone does not take a living launcher's stack" */
      it("keeps the stack for the launcher, and takes it down when the launcher dies", async () => {
        const stack = writeStack(DEEP_STACK);
        const launcher = launchFrom(
          `node ${asBashWord(SUPERVISOR)} ${asBashWord(stack)}`,
        );
        expect(await stackIsUp()).toBe(true);
        await waitUntil(() => supervisorPid() !== null);
        const supervisor = supervisorPid();
        expect(supervisor).not.toBeNull();

        process.kill(supervisor as number, "SIGKILL");
        await sleep(1500);
        // Launcher, lanes and sentinel are all still here: a crashed
        // supervisor is not a reason to pull work out from under a live shell.
        expect(stackPids().length).toBeGreaterThanOrEqual(3);

        process.kill(launcher, "SIGKILL");
        expect(await waitUntil(() => stackPids().length === 0)).toBe(true);
      });
    });

    describe("when the stack is running", () => {
      /** @scenario "The stack is never running without a guard outside the doomed group" */
      it("was started by the sentinel, so it was never unguarded", async () => {
        const stack = writeStack(DEEP_STACK);
        launchFrom(`node ${asBashWord(SUPERVISOR)} ${asBashWord(stack)}`);
        expect(await stackIsUp()).toBe(true);

        // The stack script's own process, and who created it. A sentinel
        // posted AFTER the stack would leave the supervisor as the parent, and
        // with it the window this asserts away: for as long as posting takes,
        // a detached stack whose only watcher is inside the doomed group.
        const tree = processTree();
        const stackProc = tree.find(
          (p) => p.command.includes(stack) && !p.command.includes(SUPERVISOR),
        );
        expect(stackProc).toBeDefined();

        const parent = tree.find((p) => p.pid === stackProc?.ppid);
        expect(parent?.command).toContain("dev-supervisor.mjs");
        expect(parent?.command).toContain(SENTINEL_FLAG);
      });
    });

    describe("when the stack exits on its own", () => {
      /** @scenario "Supervision leaves nothing behind when the stack exits on its own" */
      it("leaves no sentinel running", async () => {
        // The stack runs until this test releases it, so the sentinel can be
        // observed alive first: a run that never posted one would otherwise
        // pass this test by having nothing to leave behind.
        const stopFile = path.join(scratch, "stop");
        const stack = writeStack(
          `while [ ! -f ${asBashWord(stopFile)} ]; do sleep 0.1; done`,
        );
        const launcher = launchFrom(
          `node ${asBashWord(SUPERVISOR)} ${asBashWord(stack)}`,
        );
        expect(await stackIsUp()).toBe(true);
        expect(await waitUntil(() => sentinelPids().length > 0)).toBe(true);

        writeFileSync(stopFile, "", "utf8");

        // Nobody was killed: the stack ended by itself and the sentinel went
        // with it, leaving the launcher that is still there untouched.
        expect(await waitUntil(() => sentinelPids().length === 0)).toBe(true);
        expect(pidAlive(launcher)).toBe(true);
      });
    });
  });

  describe("given supervision cannot or should not apply", () => {
    describe("when the command is run anyway", () => {
      /** @scenario "Supervision can be turned off" */
      it("runs directly when supervision is turned off", async () => {
        const result = runSupervised(["sh", "-c", `echo ${marker}-ran`], {
          LANGWATCH_DEV_SUPERVISOR: "0",
        });

        expect(result.status).toBe(0);
        expect(result.stdout).toBe(`${marker}-ran\n`);
      });

      /** @scenario "A supervisor inside a supervised stack does not add a second one" */
      it("does not supervise again inside an already supervised stack", () => {
        const result = runSupervised([
          process.execPath,
          SUPERVISOR,
          "sh",
          "-c",
          "printenv LANGWATCH_DEV_SUPERVISED",
        ]);

        expect(result.status).toBe(0);
        expect(result.stdout.trim()).toBe("1");
      });

      /** @scenario "A command still runs when it cannot be supervised" */
      it("still runs the command when there is no launcher to watch", async () => {
        const result = await runAsGroupLeader([
          "sh",
          "-c",
          `echo ${marker}-unsupervised`,
        ]);

        expect(result.status).toBe(0);
        expect(result.stdout).toBe(`${marker}-unsupervised\n`);
      });

      /** @scenario "A sentinel that cannot be started does not stop the command" */
      it("runs the command anyway when the sentinel will not spawn", () => {
        // spawn hands back a child and only then emits `error`, so this is the
        // asynchronous failure: an unheard one takes the supervisor down with
        // it, which is the one thing supervision must never do.
        const result = runSupervised(
          ["sh", "-c", `echo ${marker}-ran`],
          {},
          {
            supervisor: supervisorWith(
              "      process.execPath,\n      [\n        SELF,",
              '      "/definitely-not-node",\n      [\n        SELF,',
            ),
          },
        );

        expect(result.stdout).toBe(`${marker}-ran\n`);
        expect(result.status).toBe(0);
        expect(result.stderr).toContain("sentinel did not come up");
      });

      /** @scenario "A sentinel that cannot be started does not stop the command" */
      it("runs the command anyway when the sentinel names no stack", () => {
        const result = runSupervised(
          ["sh", "-c", `echo ${marker}-ran`],
          {},
          {
            supervisor: supervisorWith(
              "async function runSentinel(args, env) {",
              "async function runSentinel(args, env) {\n  return 1;",
            ),
          },
        );

        expect(result.stdout).toBe(`${marker}-ran\n`);
        expect(result.status).toBe(0);
        expect(result.stderr).toContain("sentinel did not come up");
      });

      /** @scenario "A command still runs when it cannot be supervised" */
      it("reports a command it cannot start rather than hanging", () => {
        const result = runSupervised([path.join(scratch, `${marker}-does-not-exist`)]);

        expect(result.status).toBe(127);
        expect(result.stderr).toContain("could not start");
      });
    });
  });
});

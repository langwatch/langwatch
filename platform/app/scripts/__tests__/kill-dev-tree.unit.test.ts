/**
 * @vitest-environment node
 *
 * Tests for scripts/kill-dev-tree.sh, the command `pnpm dev` offers when a
 * port is already held.
 *
 * Driven as real processes and real sockets, because the bug it exists to fix
 * only appears against a stack that answers being killed by starting a
 * replacement: it survives SIGTERM, and its port is free for a moment in
 * between, long enough for anything watching the port to call it done.
 *
 * Corresponds to specs/setup/dev-stack-lifecycle.feature.
 */

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "../kill-dev-tree.sh");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let scratch: string;
const started: ChildProcess[] = [];

beforeEach(() => {
  scratch = mkdtempSync(path.join(os.tmpdir(), "kill-dev-tree-test-"));
});

afterEach(async () => {
  for (const child of started.splice(0)) {
    try {
      // Its own group, so this reaches the lanes as well as the stack itself.
      process.kill(-(child.pid as number), "SIGKILL");
    } catch {
      // Already gone, which is what most of these tests assert.
    }
  }
  await sleep(100);
  rmSync(scratch, { recursive: true, force: true });
});

function bindable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.on("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

/**
 * A port nothing is listening on, picked from BELOW the ephemeral range that
 * both Linux (32768+) and macOS (49152+) allocate from. Asking the kernel for
 * an ephemeral port instead would leave a window where it hands that same port
 * to an unrelated process before the stack binds it, and the script under test
 * takes down the process group holding the port it is given. A busy CI runner
 * is exactly where that would land on someone else.
 */
async function freePort(): Promise<number> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = 20000 + Math.floor(Math.random() * 9000);
    if (await bindable(candidate)) return candidate;
  }
  throw new Error("no free port in the test range");
}

/**
 * Whatever is listening on the port, asked the same two ways the script does.
 * Throws rather than reporting "free" when it has no way to look, so a host
 * missing both tools fails the suite instead of passing it vacuously.
 */
function listening(port: number): boolean {
  const viaLsof = spawnSync(
    "lsof",
    ["-t", "-a", `-iTCP:${port}`, "-sTCP:LISTEN"],
    { encoding: "utf8" },
  );
  if (viaLsof.error === undefined) return (viaLsof.stdout ?? "").trim() !== "";

  const viaSs = spawnSync("ss", ["-ltnH", `( sport = :${port} )`], {
    encoding: "utf8",
  });
  if (viaSs.error !== undefined) {
    throw new Error("neither lsof nor ss is available to inspect ports");
  }
  return (viaSs.stdout ?? "").trim() !== "";
}

/**
 * Members of a process group that are actually running. Zombies are excluded
 * deliberately: the stack's leader is a child of this test process, so between
 * it being killed and vitest reaping it, it lingers as a `Z` that still answers
 * `kill(-pgid, 0)`. That is the test runner's bookkeeping, not a live stack,
 * and it holds neither a port nor any memory.
 */
function liveMembers(pgid: number): number {
  const result = spawnSync("ps", ["-Ao", "pgid=,stat="], { encoding: "utf8" });
  return (result.stdout ?? "")
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter(
      ([group, state]) => group === String(pgid) && !state?.startsWith("Z"),
    ).length;
}

/**
 * A lane that touches a file once its listen has actually succeeded. That file
 * is how these tests know the port is held by THIS stack rather than by
 * whatever else the machine may have raced them to it: the script takes down
 * the group behind the listener, so proceeding on "something is listening"
 * would be enough to take down a stranger.
 *
 * A file taking arguments rather than a `node -e` string, so no JavaScript is
 * ever built by interpolation.
 */
function writeLane(): string {
  const file = path.join(scratch, "lane.js");
  writeFileSync(
    file,
    [
      'const net = require("node:net");',
      'const fs = require("node:fs");',
      "const [, , port, ready] = process.argv;",
      'net.createServer().listen(Number(port), "127.0.0.1", () => {',
      "  fs.writeFileSync(ready, String(process.pid));",
      "});",
      "setInterval(() => {}, 1e9);",
      "",
    ].join("\n"),
    "utf8",
  );
  return file;
}

const readyFile = () => path.join(scratch, "lane-is-up");

/** Everything kill-dev-tree.sh shells out to, minus the port lookups. */
const SCRIPT_NEEDS = [
  "bash",
  "awk",
  "cat",
  "cut",
  "grep",
  "ps",
  "seq",
  "sleep",
  "sort",
  "tr",
];

function realPathOf(tool: string): string {
  for (const dir of ["/usr/bin", "/bin", "/usr/sbin", "/sbin"]) {
    const candidate = path.join(dir, tool);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`this suite needs ${tool} and cannot find it`);
}

/**
 * A PATH built from nothing but the utilities the script needs plus a stand-in
 * `ss`, which is how the Linux-only branch gets exercised on a laptop that has
 * no `ss` and how it stays exercised on a runner that does.
 *
 * Assembled rather than prepended for both reasons at once. iproute2 puts a
 * real `ss` in /usr/bin, which would shadow the stand-in and quietly turn these
 * into tests of the host's tools; and lsof lives in /usr/bin on Linux, which
 * would send the script down the lsof branch and never reach `ss` at all.
 */
function pathWithStubbedSs(stub: string[]): string {
  const bin = mkdtempSync(path.join(scratch, "bin-"));
  for (const tool of SCRIPT_NEEDS) {
    symlinkSync(realPathOf(tool), path.join(bin, tool));
  }
  writeFileSync(path.join(bin, "ss"), `${stub.join("\n")}\n`, "utf8");
  chmodSync(path.join(bin, "ss"), 0o755);
  return bin;
}

/** Reports the live lane in the format iproute2 prints. */
function pathWithOnlySs(port: number): string {
  return pathWithStubbedSs([
    "#!/bin/bash",
    `pid=$(cat ${readyFile()} 2>/dev/null)`,
    // Only while that lane is actually alive, so the script sees the port go
    // quiet exactly when it does rather than a line that outlives the stack.
    'if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then exit 0; fi',
    `echo 'LISTEN 0 511 127.0.0.1:${port} 0.0.0.0:* users:(("node",pid='"$pid"',fd=20))'`,
  ]);
}

/**
 * An `ss` that refuses to answer, the way a too-old or broken iproute2 would.
 * An empty answer and a failed lookup are not the same thing, and only one of
 * them means the port is free.
 */
function pathWithBrokenSs(): string {
  return pathWithStubbedSs(["#!/bin/bash", "exit 1"]);
}

/**
 * A stand-in for `start.sh`: it survives being asked to stop and answers a
 * dead lane with a new one, which is what `concurrently --restart-tries -1`
 * does. That is the shape a plain SIGTERM cannot clear.
 */
function writeRestartingStack(port: number): string {
  const file = path.join(scratch, "stack.sh");
  writeFileSync(
    file,
    [
      "#!/bin/bash",
      "trap '' TERM",
      "while true; do",
      `  ${process.execPath} ${writeLane()} ${port} ${readyFile()} &`,
      "  wait $! 2>/dev/null",
      "done",
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(file, 0o755);
  return file;
}

/** Starts a command as its own process-group leader and returns that group. */
function startInOwnGroup(command: string, args: string[]): number {
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  started.push(child);
  return child.pid as number;
}

/**
 * A listener that is emphatically not one of ours: the same node binary,
 * reached through a symlink under another name, so `ps -o comm=` reports
 * something without "node" in it and the script must leave it where it is.
 * Cheaper and more portable than reaching for a second language runtime.
 */
function startStranger(port: number): number {
  const asAnother = path.join(scratch, "dev-listener");
  symlinkSync(process.execPath, asAnother);
  return startInOwnGroup(asAnother, [
    writeLane(),
    String(port),
    path.join(scratch, "stranger-is-up"),
  ]);
}

async function waitUntil(
  predicate: () => boolean,
  { timeoutMs = 15000 } = {},
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(100);
  }
  return predicate();
}

/** Resolves once this test's own lane holds the port. */
const laneIsUp = () => waitUntil(() => existsSync(readyFile()));

function clearPorts(
  ports: string,
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync("bash", [SCRIPT, ports], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
  };
}

describe("clearing the dev ports", () => {
  describe("given a stack that replaces any lane that dies", () => {
    describe("when the port it holds is cleared", () => {
      /** @scenario "The port a stack holds is actually free afterwards" */
      it("stops the stack and the port stays free", async () => {
        const port = await freePort();
        const stack = startInOwnGroup("bash", [writeRestartingStack(port)]);
        expect(await laneIsUp()).toBe(true);

        const result = clearPorts(String(port), { KILL_DEV_TREE_GRACE: "2" });

        // The script's own account of what it did, so a failure here says what
        // it found rather than only a number.
        const said = `${result.stdout}${result.stderr}`;
        expect(result.status, said).toBe(0);
        expect(liveMembers(stack), said).toBe(0);

        // Cleared only now: a replacement lane coming up DURING the takedown
        // is the behaviour under test, not a failure. What must not happen is
        // one coming up after it. The stack replaced a lane within a second of
        // losing one, so a file that stays absent for three is a stopped stack
        // rather than the gap between two lanes.
        rmSync(readyFile(), { force: true });
        await sleep(3000);
        expect(existsSync(readyFile()), said).toBe(false);
        expect(listening(port), said).toBe(false);
      }, 30000);
    });
  });

  describe("given a host with no lsof, as the Linux runner is", () => {
    describe("when the port it holds is cleared", () => {
      /** @scenario "The port a stack holds is actually free afterwards" */
      it("resolves the listener through ss and still stops the stack", async () => {
        const port = await freePort();
        const stack = startInOwnGroup("bash", [writeRestartingStack(port)]);
        expect(await laneIsUp()).toBe(true);

        const result = clearPorts(String(port), {
          KILL_DEV_TREE_GRACE: "2",
          PATH: pathWithOnlySs(port),
        });

        const said = `${result.stdout}${result.stderr}`;
        expect(result.status, said).toBe(0);
        expect(liveMembers(stack), said).toBe(0);
      }, 30000);
    });
  });

  describe("given the caller shares a process group with a listener", () => {
    describe("when the ports are cleared", () => {
      /** @scenario "Clearing a port leaves the shell that asked alone" */
      it("leaves its own group alone", async () => {
        const port = await freePort();
        const survived = path.join(scratch, "still-here");
        // The listener and the script run in ONE group of their own, so the
        // script's own group is the one holding the port. If the guard fails
        // the damage is confined to this group rather than the test runner.
        const caller = path.join(scratch, "caller.sh");
        writeFileSync(
          caller,
          [
            "#!/bin/bash",
            `${process.execPath} ${writeLane()} ${port} ${readyFile()} &`,
            "sleep 2",
            `bash ${SCRIPT} ${port} > ${path.join(scratch, "out")} 2>&1`,
            "sleep 3",
            `touch ${survived}`,
            "sleep 30",
            "",
          ].join("\n"),
          "utf8",
        );
        chmodSync(caller, 0o755);

        const group = startInOwnGroup("bash", [caller]);
        expect(await laneIsUp()).toBe(true);

        // It got past running the script and stayed up long enough to say so.
        expect(await waitUntil(() => existsSync(survived))).toBe(true);
        expect(liveMembers(group)).toBeGreaterThan(0);
        expect(listening(port)).toBe(true);
      }, 30000);
    });
  });

  describe("given a port held by something we did not start", () => {
    describe("when the ports are cleared", () => {
      /** @scenario "A port held by something we did not start is reported, not claimed" */
      it("stops our stack, leaves it alone, and does not claim the ports", async () => {
        const ours = await freePort();
        const theirs = await freePort();
        const stack = startInOwnGroup("bash", [writeRestartingStack(ours)]);
        expect(await laneIsUp()).toBe(true);
        const stranger = startStranger(theirs);
        expect(
          await waitUntil(() =>
            existsSync(path.join(scratch, "stranger-is-up")),
          ),
        ).toBe(true);

        const result = clearPorts(`${ours},${theirs}`, {
          KILL_DEV_TREE_GRACE: "2",
        });

        const said = `${result.stdout}${result.stderr}`;
        expect(result.status, said).toBe(1);
        expect(result.stdout).not.toContain("ports free");
        expect(liveMembers(stack), said).toBe(0);
        expect(liveMembers(stranger), said).toBeGreaterThan(0);
      }, 30000);
    });
  });

  describe("given nothing is listening", () => {
    describe("when those ports are cleared", () => {
      /** @scenario "Clearing ports that nothing holds is not an error" */
      it("says so and exits cleanly", async () => {
        const port = await freePort();

        const result = clearPorts(String(port));

        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain("nothing of ours is listening");
      });

      /** @scenario "A port that cannot be inspected is never called free" */
      it("refuses to call a port free when it cannot be inspected", async () => {
        const port = await freePort();
        const isolated = pathWithBrokenSs();
        // The stand-in has to be the thing that runs. One directory on PATH,
        // holding an `ss` and no `lsof`, is what makes that true no matter what
        // the host has in /usr/bin. Without it this passes by testing nothing.
        expect(isolated).not.toContain(path.delimiter);
        expect(readdirSync(isolated)).toContain("ss");
        expect(readdirSync(isolated)).not.toContain("lsof");

        const result = clearPorts(String(port), { PATH: isolated });

        expect(result.status).not.toBe(0);
        expect(result.stdout).not.toContain("ports free");
        expect(result.stdout).not.toContain("nothing of ours");
        expect(result.stderr).toContain("could not inspect");
      });

      it("reports how to call it when given no ports at all", () => {
        const result = spawnSync("bash", [SCRIPT], { encoding: "utf8" });

        expect(result.status).toBe(64);
        expect(result.stderr).toContain("usage:");
      });
    });
  });
});

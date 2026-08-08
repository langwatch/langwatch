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
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

/** A port nothing is listening on right now. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/** Whatever is listening on the port, asked the same two ways the script does. */
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

const LANE = `require("net").createServer().listen(PORT,"127.0.0.1",()=>{});setInterval(()=>{},1e9)`;

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
      `  ${process.execPath} -e '${LANE.replace("PORT", String(port))}' &`,
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
        expect(await waitUntil(() => listening(port))).toBe(true);

        const result = clearPorts(String(port), { KILL_DEV_TREE_GRACE: "2" });

        expect(result.status).toBe(0);
        expect(liveMembers(stack)).toBe(0);
        // The stack replaced a lane within a second, so a port that is free
        // now and free after that is a stopped stack rather than a gap
        // between two lanes.
        await sleep(3000);
        expect(listening(port)).toBe(false);
      }, 30000);
    });
  });

  describe("given the caller shares a process group with a listener", () => {
    describe("when the ports are cleared", () => {
      /** @scenario "Clearing a port leaves the shell that asked alone" */
      it("leaves its own group alone", async () => {
        const port = await freePort();
        const marker = path.join(scratch, "still-here");
        // The listener and the script run in ONE group of their own, so the
        // script's own group is the one holding the port. If the guard fails
        // the damage is confined to this group rather than the test runner.
        const caller = path.join(scratch, "caller.sh");
        writeFileSync(
          caller,
          [
            "#!/bin/bash",
            `${process.execPath} -e '${LANE.replace("PORT", String(port))}' &`,
            "sleep 2",
            `bash ${SCRIPT} ${port} > ${path.join(scratch, "out")} 2>&1`,
            "sleep 3",
            `touch ${marker}`,
            "sleep 30",
            "",
          ].join("\n"),
          "utf8",
        );
        chmodSync(caller, 0o755);

        const group = startInOwnGroup("bash", [caller]);
        expect(await waitUntil(() => listening(port))).toBe(true);

        // It survived long enough to write the marker after running the script.
        expect(
          await waitUntil(() => spawnSync("test", ["-f", marker]).status === 0),
        ).toBe(true);
        expect(liveMembers(group)).toBeGreaterThan(0);
        expect(listening(port)).toBe(true);
      }, 30000);
    });
  });

  describe("given nothing is listening", () => {
    describe("when those ports are cleared", () => {
      /** @scenario "Clearing ports that nothing holds is not an error" */
      it("says so and exits cleanly", async () => {
        const port = await freePort();

        const result = clearPorts(String(port));

        expect(result.status).toBe(0);
        expect(result.stdout).toContain("nothing of ours is listening");
      });

      it("reports how to call it when given no ports at all", () => {
        const result = spawnSync("bash", [SCRIPT], { encoding: "utf8" });

        expect(result.status).toBe(64);
        expect(result.stderr).toContain("usage:");
      });
    });
  });
});

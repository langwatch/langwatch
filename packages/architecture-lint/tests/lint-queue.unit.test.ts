import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bootstrap = readFileSync(new URL("../src/cli.ts", import.meta.url), "utf8");
const queueUrl = new URL("../src/lint-queue.ts", import.meta.url).href;
type Run = {
  child: ChildProcessWithoutNullStreams;
  output: { stdout: string; stderr: string };
  done: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
};
const runs: Run[] = [];
const reservations: Server[] = [];
let scratch = "";
let ports: [number, number];

async function reservePort(): Promise<number> {
  const server = createServer();
  reservations.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP address");

  return address.port;
}

async function releaseReservations(): Promise<void> {
  await Promise.all(
    reservations
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
}

function fixture(name: string): string {
  const directory = join(scratch, name);
  mkdirSync(directory);
  writeFileSync(join(directory, "package.json"), '{"type":"module"}');
  writeFileSync(join(directory, "cli.ts"), bootstrap);
  writeFileSync(
    join(directory, "lint-queue.ts"),
    `
    import { withArchitectureLintSlot as slot } from ${JSON.stringify(queueUrl)};
    export const withArchitectureLintSlot = (run) => slot(run, ${JSON.stringify(ports)});
  `,
  );
  writeFileSync(
    join(directory, "cli-run.ts"),
    `
    process.stdout.write("engine loaded\\n");
    if (process.argv.includes("--throw")) throw new Error("fixture failure");
    if (process.argv.includes("--exit-seven")) {
      process.exitCode = 7;
    } else {
      await new Promise(resolve => process.stdin.once("data", resolve));
      process.stdin.pause();
    }
  `,
  );

  return join(directory, "cli.ts");
}

function start(cli: string, args: string[] = []): Run {
  const child = spawn(process.execPath, ["--experimental-transform-types", cli, ...args], {
    cwd: dirname(cli),
    env: { ...process.env, CHECK_SLOTS: "20", CHECK_QUEUE_HELD: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const output = { stdout: "", stderr: "" };
  child.stdout.on("data", (chunk) => {
    output.stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output.stderr += String(chunk);
  });
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    },
  );
  const run = { child, output, done };
  runs.push(run);

  return run;
}

beforeEach(async () => {
  scratch = mkdtempSync(join(tmpdir(), "architecture-lint-queue-"));
  ports = [await reservePort(), await reservePort()];
});

afterEach(async () => {
  for (const run of runs) {
    if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill("SIGKILL");
  }
  await Promise.all(runs.splice(0).map((run) => run.done));
  await releaseReservations();
  rmSync(scratch, { recursive: true, force: true });
});

describe("architecture lint admission", () => {
  /** @scenario "Concurrent architecture checks wait before loading the lint engine" */
  it("loads no engine while both slots are held, then admits only two across checkouts", async () => {
    const firstCheckout = fixture("first");
    const secondCheckout = fixture("second");
    const burst = Array.from({ length: 6 }, (_, index) =>
      start(index % 2 ? firstCheckout : secondCheckout),
    );
    await vi.waitFor(() =>
      expect(burst.every((run) => run.output.stderr.includes("waiting for a slot"))).toBe(true),
    );
    expect(burst.map((run) => run.output.stdout)).toEqual(Array(6).fill(""));

    await releaseReservations();
    await vi.waitFor(() =>
      expect(burst.filter((run) => run.output.stdout.includes("engine loaded"))).toHaveLength(2),
    );
    const active = burst.filter((run) => run.output.stdout.includes("engine loaded"));
    active[0]!.child.stdin.end("finish\n");
    expect(await active[0]!.done).toEqual({ code: 0, signal: null });
    await vi.waitFor(() =>
      expect(burst.filter((run) => run.output.stdout.includes("engine loaded"))).toHaveLength(3),
    );
    expect(
      burst.filter(
        (run) => run.child.exitCode === null && run.output.stdout.includes("engine loaded"),
      ),
    ).toHaveLength(2);
  });

  it("releases killed holders and lets waiting callers be cancelled", async () => {
    const cli = fixture("worktree");
    await releaseReservations();
    const first = start(cli);
    const second = start(cli);
    await vi.waitFor(() => {
      expect(first.output.stdout).toContain("engine loaded");
      expect(second.output.stdout).toContain("engine loaded");
    });
    const cancelled = start(cli);
    await vi.waitFor(() => expect(cancelled.output.stderr).toContain("waiting for a slot"));
    cancelled.child.kill("SIGTERM");
    expect(await cancelled.done).toEqual({ code: null, signal: "SIGTERM" });
    expect(cancelled.output.stdout).toBe("");

    const waiting = start(cli);
    await vi.waitFor(() => expect(waiting.output.stderr).toContain("waiting for a slot"));
    first.child.kill("SIGKILL");
    expect(await first.done).toEqual({ code: null, signal: "SIGKILL" });
    await vi.waitFor(() => expect(waiting.output.stdout).toContain("engine loaded"));
  });

  it("fails instead of running without a slot when admission errors", async () => {
    ports = [-1, -2];
    const failed = start(fixture("invalid-port"));
    expect((await failed.done).code).toBe(1);
    expect(failed.output.stdout).toBe("");
    expect(failed.output.stderr).toContain("ERR_SOCKET_BAD_PORT");
  });

  it.each([
    ["--throw", 1],
    ["--exit-seven", 7],
  ] as const)("preserves %s failures and releases the slot", async (argument, code) => {
    const cli = fixture("worktree");
    await releaseReservations();
    const failed = start(cli, [argument]);
    expect((await failed.done).code).toBe(code);
    const first = start(cli);
    const second = start(cli);
    await vi.waitFor(() => {
      expect(first.output.stdout).toContain("engine loaded");
      expect(second.output.stdout).toContain("engine loaded");
    });
  });
});

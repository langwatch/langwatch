import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../src/services/event-bus.ts";
import { servicePaths } from "../../src/services/paths.ts";
import { supervise } from "../../src/services/spawn.ts";
import type { RuntimeEvent } from "../../src/shared/runtime-contract.ts";

class FakeChild extends EventEmitter {
  pid: number;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;
  stdout = null;
  stderr = null;

  constructor(pid: number) {
    super();
    this.pid = pid;
  }

  kill(): boolean {
    this.killed = true;
    return true;
  }
}

const spawnedChildren: FakeChild[] = [];

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const child = new FakeChild(1000 + spawnedChildren.length);
    spawnedChildren.push(child);
    return child;
  }),
}));

function makePaths(root: string) {
  return servicePaths({
    root,
    bin: join(root, "bin"),
    app: join(root, "app"),
    data: join(root, "data"),
    redisData: join(root, "data", "redis"),
    postgresData: join(root, "data", "postgres"),
    clickhouseData: join(root, "data", "clickhouse"),
    logs: join(root, "logs"),
    pidFile: join(root, "run", "langwatch.pid"),
    lockFile: join(root, "run", "langwatch.lock"),
    envFile: join(root, ".env"),
    installManifest: join(root, "install-manifest.json"),
  });
}

/** Set the exit fields the way a real ChildProcess does before firing 'exit'. */
function exitChild(
  child: FakeChild,
  { code, signal = null }: { code: number | null; signal?: NodeJS.Signals | null },
): void {
  child.exitCode = code;
  child.signalCode = signal;
  child.emit("exit", code, signal);
}

/** Fail a spawn the way Node does for ENOENT/EACCES/EPERM: an "error" event, usually with no "exit" follow-up. */
function failToSpawn(child: FakeChild, err: NodeJS.ErrnoException): void {
  child.emit("error", err);
}

/** Let the exit handler's pipe-drain microtasks run without moving the clock. */
async function flushMicrotasks(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

function childAt(index: number): FakeChild {
  const child = spawnedChildren[index];
  if (!child) {
    throw new Error(`expected a child at index ${index}, only ${spawnedChildren.length} spawned`);
  }
  return child;
}

/** rmSync can lose a benign race against a real log write still landing (see afterEach). */
async function removeDirWithRetry(path: string, attemptsLeft = 5): Promise<void> {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch (err) {
    if (attemptsLeft <= 1) throw err;
    await new Promise((resolve) => setTimeout(resolve, 20));
    await removeDirWithRetry(path, attemptsLeft - 1);
  }
}

describe("supervise restart policy", () => {
  let root: string;
  let bus: EventBus;
  let events: RuntimeEvent[];
  let sp: ReturnType<typeof makePaths>;

  function boot() {
    const handle = supervise({
      spec: { name: "workers", command: "node", args: [], env: {} },
      paths: sp,
      bus,
    });
    return handle;
  }

  function markHealthy(): void {
    bus.emit({ type: "healthy", service: "workers", durationMs: 0 });
  }

  function restartingEvents() {
    return events.filter(
      (e): e is Extract<RuntimeEvent, { type: "restarting" }> => e.type === "restarting",
    );
  }

  beforeEach(() => {
    vi.useFakeTimers();
    spawnedChildren.length = 0;
    root = mkdtempSync(join(tmpdir(), "lw-spawn-restart-"));
    sp = makePaths(root);
    bus = new EventBus();
    events = [];
    bus.tap((ev) => events.push(ev));
  });

  afterEach(async () => {
    vi.useRealTimers();
    // Every spawnAttempt() opens a real log-file write stream; fake-timer
    // advances resolve the assertions long before that real, unfaked disk
    // I/O necessarily finishes. Give it a moment before the recursive
    // rmSync below, and retry rmSync itself, so a write that is still
    // landing does not race the directory out from under it (ENOENT/
    // ENOTEMPTY) and fail a later, unrelated test instead of this one.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await removeDirWithRetry(root);
  });

  describe("given a service that already reported healthy", () => {
    describe("when its process crashes", () => {
      it("emits a restarting event instead of crashed", async () => {
        boot();
        markHealthy();
        exitChild(childAt(0), { code: 137 });
        await flushMicrotasks();

        expect(restartingEvents()).toHaveLength(1);
        expect(restartingEvents()[0]).toMatchObject({
          service: "workers",
          code: 137,
          attempt: 1,
          maxAttempts: 3,
          delayMs: 1_000,
        });
        expect(events.some((e) => e.type === "crashed")).toBe(false);
      });

      it("respawns after the first backoff delay with a fresh pidfile", async () => {
        const handle = boot();
        markHealthy();
        exitChild(childAt(0), { code: 137 });
        await flushMicrotasks();

        expect(spawnedChildren).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(999);
        expect(spawnedChildren).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(spawnedChildren).toHaveLength(2);
        expect(handle.pid).toBe(childAt(1).pid);
        expect(readFileSync(sp.pid("workers"), "utf8")).toBe(String(childAt(1).pid));
      });

      it("writes a supervisor marker line into the service log", async () => {
        boot();
        markHealthy();
        exitChild(childAt(0), { code: 137 });
        await flushMicrotasks();

        vi.useRealTimers();
        await vi.waitFor(() => {
          expect(readFileSync(sp.log("workers"), "utf8")).toContain(
            "[supervisor] workers exited (code 137), restarting in 1000ms (attempt 1/3)",
          );
        });
      });
    });

    describe("when the process is killed by a signal", () => {
      it("carries the signal on the restarting event", async () => {
        boot();
        markHealthy();
        exitChild(childAt(0), { code: null, signal: "SIGKILL" });
        await flushMicrotasks();

        expect(restartingEvents()[0]).toMatchObject({
          service: "workers",
          signal: "SIGKILL",
          attempt: 1,
        });
      });
    });

    describe("when the process keeps crashing after every restart", () => {
      it("backs off 1s then 5s then 15s and gives up with a crashed event", async () => {
        boot();
        markHealthy();

        exitChild(childAt(0), { code: 137 });
        await flushMicrotasks();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(spawnedChildren).toHaveLength(2);

        exitChild(childAt(1), { code: 137 });
        await flushMicrotasks();
        await vi.advanceTimersByTimeAsync(4_999);
        expect(spawnedChildren).toHaveLength(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(spawnedChildren).toHaveLength(3);

        exitChild(childAt(2), { code: 137 });
        await flushMicrotasks();
        await vi.advanceTimersByTimeAsync(15_000);
        expect(spawnedChildren).toHaveLength(4);

        exitChild(childAt(3), { code: 137 });
        await flushMicrotasks();

        expect(restartingEvents().map((e) => e.attempt)).toEqual([1, 2, 3]);
        expect(restartingEvents().map((e) => e.delayMs)).toEqual([1_000, 5_000, 15_000]);
        const crashes = events.filter((e) => e.type === "crashed");
        expect(crashes).toHaveLength(1);
        expect(crashes[0]).toMatchObject({ service: "workers", code: 137 });

        await vi.advanceTimersByTimeAsync(120_000);
        expect(spawnedChildren).toHaveLength(4);
      });
    });

    describe("when a restarted process stays up past the steady-state window", () => {
      it("earns back the full restart budget", async () => {
        boot();
        markHealthy();

        exitChild(childAt(0), { code: 1 });
        await flushMicrotasks();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(spawnedChildren).toHaveLength(2);

        await vi.advanceTimersByTimeAsync(5 * 60_000);

        exitChild(childAt(1), { code: 1 });
        await flushMicrotasks();

        expect(restartingEvents().map((e) => e.attempt)).toEqual([1, 1]);
      });
    });

    describe("when stop() is called during the backoff wait", () => {
      it("cancels the pending respawn and emits stopped", async () => {
        const handle = boot();
        markHealthy();
        exitChild(childAt(0), { code: 137 });
        await flushMicrotasks();

        await handle.stop();
        expect(events.at(-1)).toMatchObject({
          type: "stopped",
          service: "workers",
        });

        await vi.advanceTimersByTimeAsync(120_000);
        expect(spawnedChildren).toHaveLength(1);
        expect(events.some((e) => e.type === "crashed")).toBe(false);
      });
    });

    describe("when the process exits cleanly", () => {
      it("emits stopped without restarting", async () => {
        boot();
        markHealthy();
        exitChild(childAt(0), { code: 0 });
        await flushMicrotasks();

        expect(events.some((e) => e.type === "restarting")).toBe(false);
        expect(events.at(-1)).toMatchObject({
          type: "stopped",
          service: "workers",
        });
        await vi.advanceTimersByTimeAsync(120_000);
        expect(spawnedChildren).toHaveLength(1);
      });
    });

    describe("when its process fails to respawn mid-life", () => {
      it("treats a spawn error the same as any other crash, restarting with backoff", async () => {
        boot();
        markHealthy();
        const err = Object.assign(new Error("spawn workers EACCES"), {
          code: "EACCES",
        });
        failToSpawn(childAt(0), err);
        await flushMicrotasks();

        expect(restartingEvents()).toHaveLength(1);
        expect(restartingEvents()[0]).toMatchObject({
          service: "workers",
          attempt: 1,
          maxAttempts: 3,
          delayMs: 1_000,
        });
      });
    });

    describe("when a spawn both errors and (on some platforms) still exits", () => {
      it("only dispatches once, keyed off whichever event arrives first", async () => {
        boot();
        markHealthy();
        const err = Object.assign(new Error("spawn workers ENOENT"), {
          code: "ENOENT",
        });
        failToSpawn(childAt(0), err);
        exitChild(childAt(0), { code: 1 });
        await flushMicrotasks();

        expect(restartingEvents()).toHaveLength(1);
      });
    });
  });

  describe("given a service that never reported healthy", () => {
    describe("when its process dies during boot", () => {
      it("emits crashed immediately and never restarts", async () => {
        boot();
        exitChild(childAt(0), { code: 1 });
        await flushMicrotasks();

        expect(events.some((e) => e.type === "restarting")).toBe(false);
        const crashes = events.filter((e) => e.type === "crashed");
        expect(crashes).toHaveLength(1);
        expect(crashes[0]).toMatchObject({ service: "workers", code: 1 });

        await vi.advanceTimersByTimeAsync(120_000);
        expect(spawnedChildren).toHaveLength(1);
      });
    });

    describe("when the command fails to spawn at all", () => {
      it("emits crashed instead of crashing the CLI process", async () => {
        boot();
        const err = Object.assign(new Error("spawn workers ENOENT"), {
          code: "ENOENT",
        });
        failToSpawn(childAt(0), err);
        await flushMicrotasks();

        expect(events.some((e) => e.type === "restarting")).toBe(false);
        const crashes = events.filter((e) => e.type === "crashed");
        expect(crashes).toHaveLength(1);
        expect(crashes[0]).toMatchObject({ service: "workers" });

        await vi.advanceTimersByTimeAsync(120_000);
        expect(spawnedChildren).toHaveLength(1);
      });

      it("writes the spawn error into the service log", async () => {
        boot();
        const err = Object.assign(new Error("spawn workers ENOENT"), {
          code: "ENOENT",
        });
        failToSpawn(childAt(0), err);
        await flushMicrotasks();

        vi.useRealTimers();
        await vi.waitFor(() => {
          expect(readFileSync(sp.log("workers"), "utf8")).toContain(
            "[supervisor] workers failed to spawn: spawn workers ENOENT",
          );
        });
      });
    });
  });
});

/**
 * What happens to the execution window when a command is abandoned.
 *
 * The caller of a hung or cancelled command is settled AT ONCE (124/130) — a
 * timeout or a Ctrl-C must never make anybody wait. The window, though, stays
 * held until the abandoned work actually settles: node cannot unwind its
 * promise chain, so it is still running, and the next request's `applyWindow`
 * would chdir and rewrite `process.env` underneath it. A command that never
 * settles at all is bounded by the abandon grace, after which the daemon stops
 * being a daemon rather than corrupt anybody.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// The executor builds the commander tree per request; these tests are about
// the window/timeout lifecycle, not parsing, so the program is a stub.
vi.mock("../../program", () => ({
  buildProgram: vi.fn(),
}));

import { buildProgram } from "../../program";
import { ExecutionWindow } from "../execution";
import { createCommandExecutor } from "../runner";
import { noopTelemetry } from "../telemetry";

const mockedBuildProgram = vi.mocked(buildProgram);

/** A program whose command never settles — the hung command. */
const hungProgram = (): never =>
  ({ parseAsync: vi.fn(() => new Promise(() => undefined)) }) as never;

/** A program whose command succeeds immediately. */
const okProgram = (): never =>
  ({ parseAsync: vi.fn(() => Promise.resolve()) }) as never;

/**
 * A program that hangs until the test resumes it, recording what the process
 * globals looked like at the moment it continued — which is what an abandoned
 * command would actually resolve its relative paths against.
 */
const resumableProgram = (): {
  program: never;
  resume: () => void;
  cwdOnResume: () => string | undefined;
} => {
  let release: (() => void) | undefined;
  let cwdOnResume: string | undefined;
  const program = {
    parseAsync: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = () => {
            cwdOnResume = process.cwd();
            resolve();
          };
        }),
    ),
  } as never;
  return {
    program,
    resume: () => release?.(),
    cwdOnResume: () => cwdOnResume,
  };
};

const collect = (): {
  sink: (stream: "stdout" | "stderr", chunk: Buffer) => void;
  stderr: () => string;
} => {
  const chunks: { stream: string; data: Buffer }[] = [];
  return {
    sink: (stream, chunk) => chunks.push({ stream, data: chunk }),
    stderr: () =>
      Buffer.concat(
        chunks.filter((c) => c.stream === "stderr").map((c) => c.data),
      ).toString(),
  };
};

describe("createCommandExecutor", () => {
  let window: ExecutionWindow;
  let dirA: string;
  let dirB: string;
  const savedCwd = process.cwd();

  beforeEach(() => {
    dirA = fs.mkdtempSync(path.join(os.tmpdir(), "lw-run-a-"));
    dirB = fs.mkdtempSync(path.join(os.tmpdir(), "lw-run-b-"));
    window = new ExecutionWindow();
    mockedBuildProgram.mockReset();
  });

  afterEach(() => {
    window.reset();
    process.chdir(savedCwd);
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  });

  const request = (
    requestId: string,
    cwd: string,
    sink: (stream: "stdout" | "stderr", chunk: Buffer) => void,
  ) => ({
    requestId,
    args: ["status"],
    cwd,
    env: {},
    colorLevel: 0,
    sink,
  });

  describe("when the caller's working directory no longer exists", () => {
    it("rejects the server-facing promise, so the client re-runs in-process", async () => {
      // ExecutionWindow.acquire rejects (chdir throws) before any output is
      // produced. The server has a fallback branch for exactly this; the
      // executor must propagate the rejection to it — swallowing it into a
      // fake `exit 0` with empty output is the "silent, looks like it worked"
      // failure the daemon is designed against.
      const doomed = fs.mkdtempSync(path.join(os.tmpdir(), "lw-run-gone-"));
      fs.rmSync(doomed, { recursive: true, force: true });

      const executor = createCommandExecutor({
        window,
        telemetry: noopTelemetry,
        requestTimeoutMs: 5_000,
      });

      const running = executor(request("r1", doomed, collect().sink));

      await expect(running.completed).rejects.toThrow();
      // The command never started: no program was built, no window is held.
      expect(mockedBuildProgram).not.toHaveBeenCalled();
      expect(window.inflightCount).toBe(0);
    });
  });

  describe("when a command never finishes", () => {
    it("settles its caller at 124 without waiting for the work", async () => {
      mockedBuildProgram.mockReturnValue(hungProgram());
      const executor = createCommandExecutor({
        window,
        telemetry: noopTelemetry,
        requestTimeoutMs: 30,
        abandonGraceMs: 60_000,
        onWedged: vi.fn(),
      });
      const out = collect();

      const running = executor(request("r1", dirA, out.sink));
      const code = await running.completed;

      expect(code).toBe(124);
      expect(out.stderr()).toContain("timed out");
    });

    it("keeps holding its window, because the abandoned work is still running", async () => {
      mockedBuildProgram.mockReturnValue(hungProgram());
      const executor = createCommandExecutor({
        window,
        telemetry: noopTelemetry,
        requestTimeoutMs: 30,
        abandonGraceMs: 60_000,
        onWedged: vi.fn(),
      });

      await expect(
        executor(request("r1", dirA, collect().sink)).completed,
      ).resolves.toBe(124);

      // Releasing here would admit the next caller and chdir underneath work
      // that has not stopped running.
      expect(window.inflightCount).toBe(1);
    });
  });

  describe("when timed-out work resumes after another caller has arrived", () => {
    it("still sees its OWN working directory, not the next caller's", async () => {
      // The bug this guards: releasing the window on timeout let the next
      // request's applyWindow chdir + rewrite process.env, so an abandoned
      // `workflows run --output results.json` wrote into ANOTHER caller's
      // directory, under another caller's credentials.
      const hung = resumableProgram();
      mockedBuildProgram.mockReturnValue(hung.program);
      const executor = createCommandExecutor({
        window,
        telemetry: noopTelemetry,
        requestTimeoutMs: 30,
        abandonGraceMs: 60_000,
        onWedged: vi.fn(),
      });

      const first = executor(request("r1", dirA, collect().sink));
      await expect(first.completed).resolves.toBe(124);

      // A different-tuple caller arrives while the abandoned work runs on.
      mockedBuildProgram.mockReturnValue(okProgram());
      const second = executor(request("r2", dirB, collect().sink));
      await new Promise((resolve) => setTimeout(resolve, 20));

      // It waits its turn rather than moving the ground under r1.
      expect(window.queuedCount).toBe(1);

      hung.resume();
      await expect(second.completed).resolves.toBe(0);

      expect(hung.cwdOnResume()).toBe(fs.realpathSync(dirA));
      expect(hung.cwdOnResume()).not.toBe(fs.realpathSync(dirB));
    });
  });

  describe("when the client cancels a hung command", () => {
    it("settles the caller at 130 at once, and hands the window back only when the work settles", async () => {
      const hung = resumableProgram();
      mockedBuildProgram.mockReturnValue(hung.program);
      const executor = createCommandExecutor({
        window,
        telemetry: noopTelemetry,
        requestTimeoutMs: 60_000,
        abandonGraceMs: 60_000,
        onWedged: vi.fn(),
      });

      const running = executor(request("r1", dirA, collect().sink));
      // Let the command actually start and take the window.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(window.inflightCount).toBe(1);

      running.cancel(130);

      await expect(running.completed).resolves.toBe(130);
      expect(window.inflightCount).toBe(1);

      hung.resume();
      await vi.waitFor(() => expect(window.inflightCount).toBe(0));

      // ...and only now can a different-tuple caller take the window.
      const releaseB = await window.acquire({ cwd: dirB, env: {}, colorLevel: 0 });
      releaseB();
    });
  });

  describe("when abandoned work never settles at all", () => {
    it("stops being a daemon rather than release a window it cannot make safe", async () => {
      const wedged = vi.fn();
      mockedBuildProgram.mockReturnValue(hungProgram());
      const executor = createCommandExecutor({
        window,
        telemetry: noopTelemetry,
        requestTimeoutMs: 20,
        abandonGraceMs: 40,
        onWedged: wedged,
      });

      await expect(
        executor(request("r1", dirA, collect().sink)).completed,
      ).resolves.toBe(124);

      await vi.waitFor(() =>
        expect(wedged).toHaveBeenCalledWith({
          requestId: "r1",
          graceMs: 40,
        }),
      );
      // Never quietly released: the whole point is that this window is unsafe.
      expect(window.inflightCount).toBe(1);
    });
  });

  describe("when the cancel lands between admission and taking the window", () => {
    it("hands the window straight back instead of holding it forever", async () => {
      // The narrowest interleaving there is: `drain()` has already resolved this
      // request's acquire — so ExecutionWindow's abort listener sees an admitted
      // waiter and does nothing — but the continuation that assigns
      // `releaseWindow` has not run yet, so `armAbandonGrace` has nothing to arm.
      //
      // A window is genuinely held at that instant with no grace timer bounding
      // it. If the continuation did not re-check `cancelled` and release, the
      // daemon would sit at inflight 1 forever: the work never starts, so
      // nothing ever settles, so `releaseOnce` never runs — and the idle timer
      // cannot fire either, because a request is in flight. That is exactly the
      // state `exitWhenWedged` exists to prevent, and it would be unreachable.
      //
      // A stub window is the only way to hold the resolution open across the
      // single microtask that separates the two.
      mockedBuildProgram.mockReturnValue(hungProgram());

      let admit!: (release: () => void) => void;
      let released = false;
      const stubWindow = {
        acquire: () =>
          new Promise<() => void>((resolve) => {
            admit = resolve;
          }),
      } as unknown as ExecutionWindow;

      const wedged = vi.fn();
      const executor = createCommandExecutor({
        window: stubWindow,
        telemetry: noopTelemetry,
        requestTimeoutMs: 60_000,
        abandonGraceMs: 30,
        onWedged: wedged,
      });

      const running = executor(request("r1", dirA, collect().sink));
      // Let the executor reach its `await window.acquire(...)`.
      await Promise.resolve();

      // Admitted...
      admit(() => {
        released = true;
      });
      // ...and cancelled before the continuation can assign `releaseWindow`.
      running.cancel(130);

      await expect(running.completed).resolves.toBe(130);

      // The window came back, and the command never ran under it.
      expect(released).toBe(true);
      expect(mockedBuildProgram).not.toHaveBeenCalled();

      // Released cleanly, so nothing was abandoned and the grace never fires.
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(wedged).not.toHaveBeenCalled();
    });
  });

  describe("when a QUEUED request is cancelled", () => {
    it("leaves the queue rather than being admitted after its caller is gone", async () => {
      const hung = resumableProgram();
      mockedBuildProgram.mockReturnValue(hung.program);
      const executor = createCommandExecutor({
        window,
        telemetry: noopTelemetry,
        requestTimeoutMs: 60_000,
        abandonGraceMs: 60_000,
        onWedged: vi.fn(),
      });

      const first = executor(request("r1", dirA, collect().sink));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(window.inflightCount).toBe(1);

      // Different cwd: queues behind the hung window-A request.
      const second = executor(request("r2", dirB, collect().sink));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(window.queuedCount).toBe(1);

      second.cancel(130);

      await expect(second.completed).resolves.toBe(130);
      expect(window.queuedCount).toBe(0);

      first.cancel(130);
      await expect(first.completed).resolves.toBe(130);

      // r1's abandoned work still holds window A — that is fix #2's contract —
      // so the queue draining is what this test is about, and it drained.
      expect(window.queuedCount).toBe(0);

      // Once r1's work finally settles, window B is takeable again.
      hung.resume();
      await vi.waitFor(() => expect(window.inflightCount).toBe(0));
      const releaseB = await window.acquire({ cwd: dirB, env: {}, colorLevel: 0 });
      releaseB();
    });
  });
});

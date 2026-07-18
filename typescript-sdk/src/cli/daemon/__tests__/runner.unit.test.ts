/**
 * Hung and cancelled commands must not pin their execution window: a request
 * that never finishes would otherwise hold its (cwd, env, colour) tuple
 * forever — blocking every caller whose tuple differs, and suppressing the
 * daemon's idle exit (server.ts never arms the idle timer while a request is
 * in flight).
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
    it("times out with 124 and releases its window for other callers", async () => {
      mockedBuildProgram.mockReturnValue(hungProgram());
      const executor = createCommandExecutor({
        window,
        telemetry: noopTelemetry,
        requestTimeoutMs: 30,
      });
      const out = collect();

      const running = executor(request("r1", dirA, out.sink));
      const code = await running.completed;

      expect(code).toBe(124);
      expect(out.stderr()).toContain("timed out");
      expect(window.inflightCount).toBe(0);

      // A caller with a DIFFERENT window tuple is admitted immediately: the
      // hung request is no longer holding the process globals.
      mockedBuildProgram.mockReturnValue(okProgram());
      const second = executor(request("r2", dirB, collect().sink));
      await expect(second.completed).resolves.toBe(0);
    });
  });

  describe("when the client cancels a hung command", () => {
    it("settles immediately and releases the window", async () => {
      mockedBuildProgram.mockReturnValue(hungProgram());
      const executor = createCommandExecutor({
        window,
        telemetry: noopTelemetry,
        requestTimeoutMs: 60_000,
      });

      const running = executor(request("r1", dirA, collect().sink));
      // Let the command actually start and take the window.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(window.inflightCount).toBe(1);

      running.cancel(130);

      await expect(running.completed).resolves.toBe(130);
      expect(window.inflightCount).toBe(0);

      // A different-tuple caller no longer queues behind the corpse.
      const releaseB = await window.acquire({ cwd: dirB, env: {}, colorLevel: 0 });
      releaseB();
    });
  });

  describe("when a QUEUED request is cancelled", () => {
    it("leaves the queue rather than being admitted after its caller is gone", async () => {
      mockedBuildProgram.mockReturnValue(hungProgram());
      const executor = createCommandExecutor({
        window,
        telemetry: noopTelemetry,
        requestTimeoutMs: 60_000,
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

      // The queue drained cleanly: window B can be taken now.
      const releaseB = await window.acquire({ cwd: dirB, env: {}, colorLevel: 0 });
      releaseB();
    });
  });
});

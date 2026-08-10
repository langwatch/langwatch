import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installShutdownHandlers,
  runGracefulShutdown,
  type ShutdownPhase,
} from "../runGracefulShutdown";
import { clearTelemetryFlushes, registerTelemetryFlush } from "../telemetry";

function silentLogger() {
  return { info: vi.fn(), error: vi.fn() };
}

// The registry is process-global, so a test that registers must reset.
afterEach(() => clearTelemetryFlushes());

const SIGNALS = ["SIGTERM", "SIGINT"] as const;

/**
 * Takes the process's signal listeners away for the duration of one test and
 * hands back a restore. Vitest installs its own, and a test that emits a real
 * signal would otherwise trip them — and leave its own behind for every later
 * file, since the suite runs with isolate:false.
 */
function borrowSignalListeners(): () => void {
  const saved = SIGNALS.map((s) => [s, process.listeners(s).slice()] as const);
  for (const [signal, listeners] of saved) {
    for (const l of listeners) process.removeListener(signal, l);
  }
  return () => {
    for (const [signal, listeners] of saved) {
      for (const l of process.listeners(signal)) {
        process.removeListener(signal, l);
      }
      for (const l of listeners) process.on(signal, l);
    }
  };
}

describe("runGracefulShutdown", () => {
  describe("given several teardown phases", () => {
    describe("when a shutdown runs", () => {
      /** @scenario Shutdown phases run in order, never concurrently */
      it("runs each phase to completion before starting the next", async () => {
        const order: string[] = [];
        const phase = (name: string, ms: number): ShutdownPhase => ({
          name,
          run: async () => {
            order.push(`${name}:start`);
            await new Promise((r) => setTimeout(r, ms));
            order.push(`${name}:end`);
          },
        });
        const exit = vi.fn() as unknown as (code: number) => never;

        await runGracefulShutdown({
          signal: "SIGTERM",
          logger: silentLogger(),
          exit,
          phases: [phase("a", 15), phase("b", 5)],
        });

        expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"]);
        expect(exit).toHaveBeenCalledWith(0);
      });

      /** @scenario A failing phase does not skip the phases after it */
      it("logs the failure and continues", async () => {
        const ran: string[] = [];
        const logger = silentLogger();
        const exit = vi.fn() as unknown as (code: number) => never;

        await runGracefulShutdown({
          signal: "SIGTERM",
          logger,
          exit,
          phases: [
            {
              name: "websockets",
              run: () => {
                throw new Error("ws close blew up");
              },
            },
            { name: "app", run: () => void ran.push("app") },
          ],
        });

        expect(ran).toEqual(["app"]);
        expect(logger.error).toHaveBeenCalledWith(
          expect.objectContaining({ phase: "websockets" }),
          expect.any(String),
        );
        expect(exit).toHaveBeenCalledWith(0);
      });

      // Telemetry has to describe the shutdown, so it flushes after the work
      // is drained — not on a signal handler of its own, which is what the
      // metrics provider and the langwatch SDK each used to do. The SDK went
      // further and called process.exit(0) when its flush resolved, ending the
      // process a second or two into a drain entitled to the full budget.
      /** @scenario Telemetry flushes after the work, and never ends the process itself */
      it("runs registered telemetry flushes last", async () => {
        const order: string[] = [];
        const exit = vi.fn() as unknown as (code: number) => never;
        registerTelemetryFlush({
          name: "sdk",
          run: async () => void order.push("telemetry"),
        });

        await runGracefulShutdown({
          signal: "SIGTERM",
          logger: silentLogger(),
          exit,
          phases: [{ name: "app", run: () => void order.push("app") }],
        });

        expect(order).toEqual(["app", "telemetry"]);
        // Exactly once, by the runner, after everything — not by a provider.
        expect(exit).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledWith(0);
      });

      /** @scenario A failing telemetry flush does not fail the shutdown */
      it("logs a failing flush and still exits zero", async () => {
        const exit = vi.fn() as unknown as (code: number) => never;
        const logger = silentLogger();
        registerTelemetryFlush({
          name: "sdk",
          run: async () => {
            throw new Error("collector unreachable");
          },
        });

        await runGracefulShutdown({
          signal: "SIGTERM",
          logger,
          exit,
          phases: [],
        });

        expect(logger.error).toHaveBeenCalledWith(
          expect.objectContaining({ phase: "telemetry:sdk" }),
          expect.any(String),
        );
        expect(exit).toHaveBeenCalledWith(0);
      });

      // The finding that made this necessary: wsHandle.close() resolves only
      // once every websocket client has gone, and `ws` never terminates them
      // for you. One suspended laptop tab held phase 1 open forever, so the
      // queue drain — the entire point of this sequence — never ran at all.
      /** @scenario A phase that hangs is abandoned so the rest still run */
      it("times out a stuck phase and continues to the next", async () => {
        vi.useFakeTimers();
        try {
          const ran: string[] = [];
          const logger = silentLogger();
          const exit = vi.fn() as unknown as (code: number) => never;

          const done = runGracefulShutdown({
            signal: "SIGTERM",
            logger,
            exit,
            deadlineMs: 60_000,
            phases: [
              {
                name: "websockets",
                timeoutMs: 1_000,
                run: () => new Promise<void>(() => {}),
              },
              { name: "app", run: () => void ran.push("app") },
            ],
          });

          await vi.advanceTimersByTimeAsync(1_000);
          await done;

          expect(ran).toEqual(["app"]);
          expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({ phase: "websockets" }),
            expect.any(String),
          );
          expect(exit).toHaveBeenCalledWith(0);
        } finally {
          vi.useRealTimers();
        }
      });

      /** @scenario A shutdown that overruns its deadline exits on its own terms */
      it("force-exits non-zero instead of waiting for SIGKILL", async () => {
        vi.useFakeTimers();
        try {
          const exit = vi.fn() as unknown as (code: number) => never;
          const logger = silentLogger();

          const done = runGracefulShutdown({
            signal: "SIGTERM",
            logger,
            exit,
            deadlineMs: 1_000,
            phases: [
              {
                name: "hangs",
                // Longer than the process deadline, so the watchdog is what
                // fires rather than the phase timeout.
                timeoutMs: 60_000,
                run: () => new Promise<void>(() => {}),
              },
            ],
          });

          await vi.advanceTimersByTimeAsync(1_000);

          expect(exit).toHaveBeenCalledWith(1);
          expect(exit).toHaveBeenCalledTimes(1);
          expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({ deadlineMs: 1_000 }),
            expect.stringContaining("deadline"),
          );

          // Let the phase timeout settle so the run does not outlive the test
          // as a floating promise — vitest runs with isolate:false.
          await vi.advanceTimersByTimeAsync(60_000);
          await done;
        } finally {
          vi.useRealTimers();
        }
      });
    });
  });
});

describe("installShutdownHandlers", () => {
  describe("given handlers are installed", () => {
    describe("when a second signal arrives mid-shutdown", () => {
      // Kubernetes sends SIGTERM and an impatient operator adds Ctrl-C on top.
      // Without the guard the second signal starts a parallel teardown over
      // half-closed handles.
      /** @scenario A second signal during shutdown does not start a second teardown */
      it("runs the sequence once", async () => {
        const restore = borrowSignalListeners();
        let runs = 0;
        const exit = vi.fn() as unknown as (code: number) => never;
        try {
          installShutdownHandlers((signal) => ({
            signal,
            logger: silentLogger(),
            exit,
            phases: [{ name: "count", run: () => void runs++ }],
          }));

          process.emit("SIGTERM");
          process.emit("SIGINT");
          process.emit("SIGTERM");
          await new Promise((r) => setTimeout(r, 10));

          expect(runs).toBe(1);
          expect(exit).toHaveBeenCalledTimes(1);
        } finally {
          restore();
        }
      });
    });
  });
});

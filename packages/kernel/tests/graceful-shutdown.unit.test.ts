import { describe, expect, it, vi } from "vitest";
import { GracefulShutdown, type ShutdownPhase } from "../src/graceful-shutdown.ts";

function silentLogger() {
  return { info: vi.fn(), error: vi.fn() };
}

const SIGNALS = ["SIGTERM", "SIGINT"] as const;

/**
 * Takes the process's signal listeners away for one test and hands back a
 * restore. Vitest installs its own, and a test emitting a real signal would
 * trip them and leave its own behind for every later file.
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

describe("GracefulShutdown", () => {
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

        const shutdown = GracefulShutdown.create({ logger: silentLogger(), exit })
          .phase(phase("a", 15))
          .phase(phase("b", 5));
        await shutdown.run({ signal: "SIGTERM" });

        expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"]);
      });

      /** @scenario A failing phase does not skip the phases after it */
      it("logs the failure and continues", async () => {
        const ran: string[] = [];
        const logger = silentLogger();
        const exit = vi.fn() as unknown as (code: number) => never;

        const firstError = await GracefulShutdown.create({ logger, exit })
          .phase({
            name: "websockets",
            run: () => {
              throw new Error("ws close blew up");
            },
          })
          .phase({ name: "app", run: () => void ran.push("app") })
          .run({ signal: "SIGTERM" });

        expect(ran).toEqual(["app"]);
        expect(firstError).toBeInstanceOf(Error);
        expect(logger.error).toHaveBeenCalledWith(
          expect.objectContaining({ phase: "websockets" }),
          expect.any(String),
        );
      });

      // Telemetry has to describe the shutdown, so it flushes after the work
      // is drained — not on a signal handler of its own, which is what the
      // metrics provider and the langwatch SDK each used to do. The SDK went
      // further and called process.exit(0) when its flush resolved, ending the
      // process a second or two into a drain entitled to the full budget. It is
      // a phase the observability composition adds, not a global registry.
      /** @scenario Telemetry flushes after the work, and never ends the process itself */
      it("runs a telemetry flush phase last and exits exactly once", async () => {
        const restore = borrowSignalListeners();
        const order: string[] = [];
        const exit = vi.fn() as unknown as (code: number) => never;
        try {
          GracefulShutdown.create({ logger: silentLogger(), exit })
            .phase({ name: "app", run: () => void order.push("app") })
            .phase({ name: "telemetry:sdk", run: async () => void order.push("telemetry") })
            .installSignalHandlers();

          process.emit("SIGTERM");
          await vi.waitFor(() => expect(exit).toHaveBeenCalled());

          expect(order).toEqual(["app", "telemetry"]);
          // Exactly once, by the runner, after everything — not by a provider.
          expect(exit).toHaveBeenCalledTimes(1);
          expect(exit).toHaveBeenCalledWith(0);
        } finally {
          restore();
        }
      });

      /** @scenario A failing telemetry flush does not fail the shutdown */
      it("logs a failing flush and still exits zero", async () => {
        const restore = borrowSignalListeners();
        const exit = vi.fn() as unknown as (code: number) => never;
        const logger = silentLogger();
        try {
          GracefulShutdown.create({ logger, exit })
            .phase({
              name: "telemetry:sdk",
              run: async () => {
                throw new Error("collector unreachable");
              },
            })
            .installSignalHandlers();

          process.emit("SIGTERM");
          await vi.waitFor(() => expect(exit).toHaveBeenCalled());

          expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({ phase: "telemetry:sdk" }),
            expect.any(String),
          );
          expect(exit).toHaveBeenCalledWith(0);
        } finally {
          restore();
        }
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

          const done = GracefulShutdown.create({ logger, exit, deadlineMs: 60_000 })
            .phase({
              name: "websockets",
              timeoutMs: 1_000,
              run: () => new Promise<void>(() => {}),
            })
            .phase({ name: "app", run: () => void ran.push("app") })
            .run({ signal: "SIGTERM" });

          await vi.advanceTimersByTimeAsync(1_000);
          await done;

          expect(ran).toEqual(["app"]);
          expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({ phase: "websockets" }),
            expect.any(String),
          );
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

          const done = GracefulShutdown.create({ logger, exit, deadlineMs: 1_000 })
            .phase({
              name: "hangs",
              // Longer than the process deadline, so the watchdog is what
              // fires rather than the phase timeout.
              timeoutMs: 60_000,
              run: () => new Promise<void>(() => {}),
            })
            .run({ signal: "SIGTERM" });

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

  describe("given a drain phase that never finishes", () => {
    describe("when the process is terminating", () => {
      // The scenario itself is bound by the worker process test; this pins the
      // class option that implements it.
      it("gives up on the drain and leaves the later releases alone", async () => {
        vi.useFakeTimers();
        try {
          const released: string[] = [];
          const done = GracefulShutdown.create({ logger: silentLogger(), terminating: true })
            .phase({
              name: "drain",
              drainPhase: true,
              timeoutMs: 1_000,
              run: () => new Promise<void>(() => {}),
            })
            .phase({ name: "connections", run: () => void released.push("connections") })
            .run();

          await vi.advanceTimersByTimeAsync(1_000);

          expect(await done).toBeUndefined();
          expect(released).toEqual([]);
        } finally {
          vi.useRealTimers();
        }
      });
    });

    describe("when the process is staying up", () => {
      it("releases the handles anyway", async () => {
        vi.useFakeTimers();
        try {
          const released: string[] = [];
          const done = GracefulShutdown.create({ logger: silentLogger() })
            .phase({
              name: "drain",
              drainPhase: true,
              timeoutMs: 1_000,
              run: () => new Promise<void>(() => {}),
            })
            .phase({ name: "connections", run: () => void released.push("connections") })
            .run();

          await vi.advanceTimersByTimeAsync(1_000);
          await done;

          expect(released).toEqual(["connections"]);
        } finally {
          vi.useRealTimers();
        }
      });
    });
  });

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
          GracefulShutdown.create({ logger: silentLogger(), exit })
            .phase({ name: "count", run: () => void runs++ })
            .installSignalHandlers();

          process.emit("SIGTERM");
          process.emit("SIGINT");
          process.emit("SIGTERM");
          // Polled rather than slept on: the sequence is async, and a fixed
          // delay can expire before exit(0) lands, which would fail here for
          // timing rather than for behaviour.
          await vi.waitFor(() => expect(exit).toHaveBeenCalled());

          expect(runs).toBe(1);
          expect(exit).toHaveBeenCalledTimes(1);
        } finally {
          restore();
        }
      });
    });
  });
});

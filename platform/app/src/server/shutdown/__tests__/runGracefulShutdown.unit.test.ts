import { describe, expect, it, vi } from "vitest";
import {
  runGracefulShutdown,
  type ShutdownPhase,
} from "../runGracefulShutdown";

function silentLogger() {
  return { info: vi.fn(), error: vi.fn() };
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

      /** @scenario A shutdown that overruns its deadline exits on its own terms */
      it("force-exits non-zero instead of waiting for SIGKILL", async () => {
        vi.useFakeTimers();
        try {
          const exit = vi.fn() as unknown as (code: number) => never;
          const logger = silentLogger();

          void runGracefulShutdown({
            signal: "SIGTERM",
            logger,
            exit,
            deadlineMs: 1_000,
            phases: [{ name: "hangs", run: () => new Promise<void>(() => {}) }],
          });

          await vi.advanceTimersByTimeAsync(1_000);

          expect(exit).toHaveBeenCalledWith(1);
          expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({ deadlineMs: 1_000 }),
            expect.stringContaining("deadline"),
          );
        } finally {
          vi.useRealTimers();
        }
      });
    });
  });
});

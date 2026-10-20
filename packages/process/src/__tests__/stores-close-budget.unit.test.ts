import { hostedStores, type ProcessMemberSource } from "@langwatch/process-stores";
import { createTestLogger } from "@langwatch/test-harness";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GracefulShutdown } from "../lifecycle/graceful-shutdown.ts";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Stores whose close takes `closeMs`, as eventing's queue drain does. */
function slowStores(closeMs: number): ProcessMemberSource & { closed: boolean } {
  const source: ProcessMemberSource & { closed: boolean } = {
    closed: false,
    order: [],
    read: () => {
      throw new Error("these stores open no client");
    },
    [Symbol.asyncDispose]: () => source.close(),
    close: () =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          source.closed = true;
          resolve();
        }, closeMs);
      }),
  };
  return source;
}

/** pino's numeric error level. */
const ERROR_LEVEL = 50;

async function closeThroughRunner(component: ReturnType<typeof hostedStores>) {
  const { logger, lines } = createTestLogger();
  const shutdown = GracefulShutdown.create({ logger, terminating: true });
  shutdown.phase({
    name: component.name,
    run: component.stop,
    drainPhase: component.drain,
    timeoutMs: component.timeoutMs,
  });
  const running = shutdown.run();
  await vi.advanceTimersByTimeAsync(40_000);
  const firstError = await running;
  return { firstError, errorLines: lines.filter((line) => line.level === ERROR_LEVEL) };
}

describe("hostedStores", () => {
  describe("given SHUTDOWN_DRAIN_TIMEOUT_MS names a drain budget longer than ten seconds", () => {
    describe("when the process stores take longer than ten seconds to close", () => {
      /** @scenario "Closing the stores gets the queue's drain budget, not the runner default" */
      it("lets them finish closing instead of abandoning the phase", async () => {
        const source = slowStores(20_000);

        const { firstError, errorLines } = await closeThroughRunner(
          hostedStores({ source, drainTimeoutMs: 25_000 }),
        );

        expect(firstError).toBeUndefined();
        expect(source.closed).toBe(true);
        expect(errorLines).toEqual([]);
      });
    });
  });

  describe("given no drain budget is named", () => {
    describe("when the process stores take as long as the queue's default drain", () => {
      it("still outwaits it", async () => {
        const source = slowStores(25_000);

        const { firstError, errorLines } = await closeThroughRunner(hostedStores({ source }));

        expect(firstError).toBeUndefined();
        expect(source.closed).toBe(true);
        // A phase the runner abandoned still closes the stores late; only its error line tells.
        expect(errorLines).toEqual([]);
      });
    });
  });
});

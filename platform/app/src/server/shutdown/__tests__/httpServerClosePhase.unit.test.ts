import { describe, expect, it, vi } from "vitest";

import { SHUTDOWN_BUDGET } from "../budget";
import { createHttpServerClosePhase } from "../httpServerClosePhase";

interface FakeServerOptions {
  /** Sockets that only go away when closeAllConnections() destroys them. */
  stragglers?: number;
  /** How long the straggler takes to end on its own, if it ever does. */
  settleAfterMs?: number;
}

function makeFakeServer({
  stragglers = 0,
  settleAfterMs,
}: FakeServerOptions = {}) {
  let remaining = stragglers;
  let closeCallback: (() => void) | undefined;
  const settle = () => {
    if (remaining === 0) closeCallback?.();
  };
  if (settleAfterMs !== void 0) {
    setTimeout(() => {
      remaining = 0;
      settle();
    }, settleAfterMs).unref();
  }
  return {
    close: vi.fn((callback?: () => void) => {
      closeCallback = callback;
      settle();
    }),
    closeIdleConnections: vi.fn(),
    closeAllConnections: vi.fn(() => {
      remaining = 0;
      settle();
    }),
  };
}

function makeLogger() {
  return { info: vi.fn(), error: vi.fn() };
}

describe("createHttpServerClosePhase", () => {
  describe("given an http listener being closed during shutdown", () => {
    describe("when every connection drains within the grace", () => {
      it("completes without destroying anything", async () => {
        const server = makeFakeServer({ stragglers: 0 });
        const phase = createHttpServerClosePhase({
          server,
          logger: makeLogger(),
          graceMs: 50,
        });

        await phase.run();

        expect(server.closeIdleConnections).toHaveBeenCalled();
        expect(server.closeAllConnections).not.toHaveBeenCalled();
      });

      /** @scenario A request in flight when the listener closes is allowed to finish */
      it("waits the grace out rather than destroying a request that would have finished", async () => {
        const server = makeFakeServer({ stragglers: 1, settleAfterMs: 10 });
        const phase = createHttpServerClosePhase({
          server,
          logger: makeLogger(),
          graceMs: 200,
        });

        await phase.run();

        expect(server.closeAllConnections).not.toHaveBeenCalled();
      });

      it("runs the extra session teardown once the listener stops accepting", async () => {
        const server = makeFakeServer({ stragglers: 0 });
        const closeSessions = vi.fn().mockResolvedValue(undefined);
        const phase = createHttpServerClosePhase({
          server,
          closeSessions,
          logger: makeLogger(),
          graceMs: 50,
        });

        await phase.run();

        expect(closeSessions).toHaveBeenCalled();
        expect(server.close.mock.invocationCallOrder[0]).toBeLessThan(
          closeSessions.mock.invocationCallOrder[0]!,
        );
      });
    });

    describe("when a connection outlives the grace", () => {
      /** @scenario A connection outliving the grace is destroyed inside the phase */
      it("destroys the stragglers so the phase itself completes", async () => {
        const server = makeFakeServer({ stragglers: 1 });
        const logger = makeLogger();
        const phase = createHttpServerClosePhase({
          server,
          logger,
          graceMs: 20,
        });

        await phase.run();

        expect(server.closeAllConnections).toHaveBeenCalled();
        expect(logger.info).toHaveBeenCalledWith(
          { graceMs: 20 },
          expect.stringContaining("destroying the stragglers"),
        );
      });
    });

    describe("when the extra session teardown is slow", () => {
      /** @scenario The drain grace is spent on requests, not on session teardown */
      it("does not spend the grace on it", async () => {
        const server = makeFakeServer({ stragglers: 1, settleAfterMs: 60 });
        const phase = createHttpServerClosePhase({
          server,
          closeSessions: () =>
            new Promise<void>((resolve) => setTimeout(resolve, 40)),
          logger: makeLogger(),
          graceMs: 50,
        });

        await phase.run();

        // The grace started with the close, so by the time the 40ms teardown is
        // done only 10ms of it is left — the connection that needs 60ms is a
        // straggler. Were the grace started after the teardown, it would have
        // had the full 50ms afterwards and survived.
        expect(server.closeAllConnections).toHaveBeenCalled();
      });
    });

    describe("when the extra session teardown fails", () => {
      /** @scenario Session teardown that fails still leaves the connections reaped */
      it("reports it and still destroys the stragglers", async () => {
        const server = makeFakeServer({ stragglers: 1 });
        const logger = makeLogger();
        const phase = createHttpServerClosePhase({
          server,
          closeSessions: () => Promise.reject(new Error("mcp teardown failed")),
          logger,
          graceMs: 20,
        });

        await expect(phase.run()).resolves.toBeUndefined();

        expect(logger.error).toHaveBeenCalledWith(
          expect.objectContaining({ error: expect.any(Error) }),
          expect.stringContaining("session teardown failed"),
        );
        expect(server.closeAllConnections).toHaveBeenCalled();
      });
    });

    describe("when the server cannot destroy connections (HTTP/2)", () => {
      it("leaves the bounding to the phase timeout instead of crashing", async () => {
        let closeCallback: (() => void) | undefined;
        let settled = false;
        const server = {
          close: vi.fn((callback?: () => void) => {
            closeCallback = callback;
          }),
        };
        const phase = createHttpServerClosePhase({
          server,
          logger: makeLogger(),
          graceMs: 20,
        });

        // ShutdownPhase.run is typed `void | Promise<void>`, so it is wrapped
        // rather than chained directly.
        const run = Promise.resolve(phase.run()).then(() => {
          settled = true;
        });
        // Nothing can reap the socket, so the phase stays pending until the
        // connection ends on its own — not merely until the grace expires.
        await new Promise((resolve) => setTimeout(resolve, 40));
        expect(settled).toBe(false);
        closeCallback?.();
        await expect(run).resolves.toBeUndefined();
      });
    });

    describe("when no clocks are passed", () => {
      /** @scenario The phase outwaits its own drain grace */
      it("takes both from the shutdown budget, ceiling outside grace", () => {
        const phase = createHttpServerClosePhase({
          server: makeFakeServer(),
          logger: makeLogger(),
        });

        expect(phase.name).toBe("http-server");
        expect(phase.timeoutMs).toBe(SHUTDOWN_BUDGET.httpClosePhaseMs);
        expect(SHUTDOWN_BUDGET.httpDrainGraceMs).toBeLessThan(
          SHUTDOWN_BUDGET.httpClosePhaseMs,
        );
      });
    });
  });
});

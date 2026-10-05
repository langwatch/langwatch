import type http from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { drainHttpServer } from "../http-drain.ts";
import { Server } from "../server.ts";
import { HTTP_CLOSE_PHASE_MS, HTTP_DRAIN_GRACE_MS } from "../shutdown-deadline.ts";

/** A listener whose `stragglers` sockets end only when destroyed, or after `settleAfterMs`. */
function drainableServer({
  stragglers = 0,
  settleAfterMs,
}: { stragglers?: number; settleAfterMs?: number } = {}) {
  let remaining = stragglers;
  let onClosed: (() => void) | undefined;
  const settle = (): void => {
    if (remaining === 0) onClosed?.();
  };
  if (settleAfterMs !== undefined) {
    setTimeout(() => {
      remaining = 0;
      settle();
    }, settleAfterMs).unref();
  }
  return {
    close: vi.fn((callback?: () => void) => {
      onClosed = callback;
      settle();
    }),
    closeIdleConnections: vi.fn(),
    closeAllConnections: vi.fn(() => {
      remaining = 0;
      settle();
    }),
  };
}

const logger = { info: vi.fn(), error: vi.fn() };

afterEach(() => {
  logger.info.mockClear();
  logger.error.mockClear();
});

describe("drainHttpServer", () => {
  describe("given a connection that finishes inside the drain grace", () => {
    describe("when the listener is drained", () => {
      it("destroys nothing and completes on its own", async () => {
        const server = drainableServer({ stragglers: 1, settleAfterMs: 10 });

        await drainHttpServer({ server, graceMs: 200, logger });

        expect(server.closeIdleConnections).toHaveBeenCalled();
        expect(server.closeAllConnections).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a connection that never ends on its own", () => {
    describe("when the drain grace passes", () => {
      /** @scenario A connection outliving the grace is destroyed inside the phase */
      it("destroys the leftovers, logs why, and completes", async () => {
        const server = drainableServer({ stragglers: 1 });

        await drainHttpServer({ server, graceMs: 20, logger });

        expect(server.closeAllConnections).toHaveBeenCalled();
        expect(logger.info).toHaveBeenCalledWith(
          { graceMs: 20 },
          expect.stringContaining("destroying the stragglers"),
        );
      });
    });
  });

  describe("given extra session teardown that takes its own time", () => {
    describe("when the listener is drained", () => {
      /** @scenario The drain grace is spent on requests, not on session teardown */
      it("starts the grace with the close, not after the teardown", async () => {
        // 40ms of teardown leaves 10ms of a 50ms grace: a 60ms request is a straggler.
        const server = drainableServer({ stragglers: 1, settleAfterMs: 60 });
        const closeSessions = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 40)));

        await drainHttpServer({ server, graceMs: 50, logger, closeSessions });

        expect(server.close.mock.invocationCallOrder[0]).toBeLessThan(
          closeSessions.mock.invocationCallOrder[0]!,
        );
        expect(server.closeAllConnections).toHaveBeenCalled();
      });
    });
  });

  describe("given extra session teardown that throws", () => {
    describe("when the listener is drained", () => {
      /** @scenario Session teardown that fails still leaves the connections reaped */
      it("logs the failure and still destroys the leftovers", async () => {
        const server = drainableServer({ stragglers: 1 });

        await expect(
          drainHttpServer({
            server,
            graceMs: 20,
            logger,
            closeSessions: () => Promise.reject(new Error("session teardown failed")),
          }),
        ).resolves.toBeUndefined();

        expect(logger.error).toHaveBeenCalledWith(
          expect.objectContaining({ error: expect.any(Error) }),
          expect.stringContaining("session teardown failed"),
        );
        expect(server.closeAllConnections).toHaveBeenCalled();
      });
    });
  });
});

describe("the shutdown budget", () => {
  describe("given the http phase and the grace it hands out", () => {
    /** @scenario The phase outwaits its own drain grace */
    it("puts the phase ceiling above the grace", () => {
      expect(HTTP_DRAIN_GRACE_MS).toBeGreaterThan(0);
      expect(HTTP_CLOSE_PHASE_MS).toBeGreaterThan(HTTP_DRAIN_GRACE_MS);
    });
  });
});

describe("Server", () => {
  describe("given a request in flight on the door", () => {
    describe("when the server closes", () => {
      /** @scenario A request in flight when the listener closes is allowed to finish */
      it("lets the request finish rather than severing it", async () => {
        const server = Server.create({ name: "drain-test", logger, ownsProcess: false });
        let arrived: () => void = () => undefined;
        const requestArrived = new Promise<void>((resolve) => {
          arrived = resolve;
        });
        await server.serve({
          name: "api",
          start: () => undefined,
          stop: () => undefined,
          handler: (_request: http.IncomingMessage, response: http.ServerResponse) => {
            arrived();
            setTimeout(() => response.writeHead(200).end("finished"), 100);
          },
        });
        const { port } = server.healthAddress as AddressInfo;

        const inFlight = fetch(`http://127.0.0.1:${port}/api/slow`);
        await requestArrived;
        const closed = server.close();
        const response = await inFlight;
        await closed;

        expect(response.status).toBe(200);
        await expect(response.text()).resolves.toBe("finished");
        expect(logger.info).not.toHaveBeenCalledWith(
          expect.anything(),
          expect.stringContaining("destroying the stragglers"),
        );
      });
    });
  });
});

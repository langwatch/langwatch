import { describe, expect, it, vi } from "vitest";

import { createHttpServerClosePhase } from "../httpServerClosePhase";

interface FakeServerOptions {
  /** Sockets that only go away when closeAllConnections() destroys them. */
  stragglers: number;
}

function makeFakeServer({ stragglers }: FakeServerOptions) {
  let remaining = stragglers;
  let closeCallback: (() => void) | undefined;
  const settle = () => {
    if (remaining === 0) closeCallback?.();
  };
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
    });
  });

  describe("when a connection outlives the grace", () => {
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

  describe("when the server cannot destroy connections (HTTP/2)", () => {
    it("leaves the bounding to the phase timeout instead of crashing", async () => {
      let closeCallback: (() => void) | undefined;
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

      const run = phase.run();
      // Nothing can reap the socket, so the phase stays pending until the
      // connection ends on its own — simulate that ending.
      await new Promise((resolve) => setTimeout(resolve, 30));
      closeCallback?.();
      await expect(run).resolves.toBeUndefined();
    });
  });
});

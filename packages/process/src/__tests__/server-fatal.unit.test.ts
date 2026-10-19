import process from "node:process";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Server } from "../server.ts";

const activeServers: Server[] = [];

afterEach(async () => {
  await Promise.all(activeServers.splice(0).map((server) => server.close()));
});

/** The handler this server installed: the newest listener, called directly so vitest's own never runs. */
function newestListener(event: "unhandledRejection" | "uncaughtException") {
  const listeners = process.listeners(event);
  return listeners[listeners.length - 1] as unknown as (reason: unknown) => void;
}

function ownedServer() {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };
  const exit = vi.fn() as unknown as (code: number) => never;
  const server = Server.create({ name: "fatal-test", logger, exit });
  activeServers.push(server);
  return { logger, exit };
}

describe("Server", () => {
  describe("given a server that owns its process", () => {
    describe("when a promise rejection goes unhandled", () => {
      /** @scenario "An unhandled rejection is logged at fatal before the process exits" */
      it("logs it at fatal and exits 1", () => {
        const { logger, exit } = ownedServer();
        const reason = new Error("redis blip");

        newestListener("unhandledRejection")(reason);

        expect(logger.fatal).toHaveBeenCalledWith(
          { error: reason, event: "unhandled rejection" },
          "fatal-test: unhandled rejection",
        );
        expect(logger.error).not.toHaveBeenCalled();
        expect(exit).toHaveBeenCalledWith(1);
      });
    });

    describe("when an exception goes uncaught", () => {
      /** @scenario "An uncaught exception is logged at fatal before the process exits" */
      it("logs it at fatal and exits 1", () => {
        const { logger, exit } = ownedServer();
        const error = new Error("boom");

        newestListener("uncaughtException")(error);

        expect(logger.fatal).toHaveBeenCalledWith(
          { error, event: "uncaught exception" },
          "fatal-test: uncaught exception",
        );
        expect(exit).toHaveBeenCalledWith(1);
      });
    });
  });
});

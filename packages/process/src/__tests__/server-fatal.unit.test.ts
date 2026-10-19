import process from "node:process";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Server } from "../server.ts";

const activeServers: Server[] = [];

afterEach(async () => {
  await Promise.all(activeServers.splice(0).map((server) => server.close()));
});

/** The rejection handler this server installed, called directly so vitest's own never runs. */
function newestRejectionListener(): (reason: unknown) => void {
  const listener = process.listeners("unhandledRejection").at(-1);
  if (!listener) throw new Error("no unhandledRejection listener is installed");
  return (reason) => listener(reason, Promise.resolve());
}

/** The exception handler this server installed, called directly so vitest's own never runs. */
function newestExceptionListener(): (error: Error) => void {
  const listener = process.listeners("uncaughtException").at(-1);
  if (!listener) throw new Error("no uncaughtException listener is installed");
  return (error) => listener(error, "uncaughtException");
}

function ownedServer() {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };
  const exit = vi.fn<(code: number) => never>();
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

        newestRejectionListener()(reason);

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

        newestExceptionListener()(error);

        expect(logger.fatal).toHaveBeenCalledWith(
          { error, event: "uncaught exception" },
          "fatal-test: uncaught exception",
        );
        expect(exit).toHaveBeenCalledWith(1);
      });
    });
  });
});

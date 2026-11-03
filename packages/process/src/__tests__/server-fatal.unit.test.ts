import process from "node:process";

import { createTestLogger } from "@langwatch/test-harness";
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

/** pino's numeric error level. */
const ERROR_LEVEL = 50;

function ownedServer() {
  const { logger, lines } = createTestLogger();
  const exit = vi.fn<(code: number) => never>();
  const server = Server.create({ name: "fatal-test", logger, exit });
  activeServers.push(server);
  return { lines, exit };
}

describe("Server", () => {
  describe("given a server that owns its process", () => {
    describe("when a promise rejection goes unhandled", () => {
      /** @scenario "An unhandled rejection is logged at fatal before the process exits" */
      it("logs it at fatal and exits 1", () => {
        const { lines, exit } = ownedServer();

        newestRejectionListener()(new Error("redis blip"));

        expect(lines.findLine("fatal", "fatal-test: unhandled rejection")).toMatchObject({
          event: "unhandled rejection",
        });
        expect(lines.filter((line) => line.level === ERROR_LEVEL)).toEqual([]);
        expect(exit).toHaveBeenCalledWith(1);
      });
    });

    describe("when an exception goes uncaught", () => {
      /** @scenario "An uncaught exception is logged at fatal before the process exits" */
      it("logs it at fatal and exits 1", () => {
        const { lines, exit } = ownedServer();

        newestExceptionListener()(new Error("boom"));

        expect(lines.findLine("fatal", "fatal-test: uncaught exception")).toMatchObject({
          event: "uncaught exception",
        });
        expect(exit).toHaveBeenCalledWith(1);
      });
    });
  });
});

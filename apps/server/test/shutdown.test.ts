import { describe, expect, it, vi } from "vitest";

import { createShutdown } from "../src/shared/shutdown.ts";

function harness({ stopServices = async () => {} }: { stopServices?: () => Promise<void> } = {}) {
  const order: string[] = [];
  const exit = vi.fn((code: number) => {
    order.push(`exit:${code}`);
  });
  const shutdown = createShutdown({
    announce: ({ exitCode }) => order.push(`announce:${exitCode}`),
    stopServices: async () => {
      order.push("stop");
      await stopServices();
    },
    flush: async () => {
      order.push("flush");
    },
    exit,
  });
  return { order, exit, shutdown };
}

describe("createShutdown", () => {
  describe("when a signal asks to stop", () => {
    /** @scenario "Ctrl+C cleanly stops every service" */
    it("stops the services before it exits with code 0", async () => {
      const { order, shutdown } = harness();

      await shutdown({ exitCode: 0 });

      expect(order).toEqual(["announce:0", "stop", "flush", "exit:0"]);
    });
  });

  describe("when a second request arrives while the first is stopping", () => {
    it("runs once and keeps the first outcome", async () => {
      const { exit, shutdown } = harness();

      await Promise.all([
        shutdown({ exitCode: 1, reason: "langwatch crashed" }),
        shutdown({ exitCode: 0 }),
      ]);

      expect(exit).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(1);
    });
  });

  describe("when stopping a service fails", () => {
    /** @scenario A crashed service with no restart budget left emits "crashed" and the CLI tears down */
    it("still exits with the outcome's code", async () => {
      const { exit, shutdown } = harness({
        stopServices: async () => {
          throw new Error("already gone");
        },
      });

      await shutdown({ exitCode: 1, reason: "redis crashed" });

      expect(exit).toHaveBeenCalledWith(1);
    });
  });
});

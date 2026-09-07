import { describe, expect, it, vi } from "vitest";
import { embeddedBackendHost } from "../backend.host.ts";
import {
  drainBackend,
  startBackend,
  type BackendApiHalf,
  type BackendWorkerHalf,
} from "../backend.process.ts";

function halfSpies(order: string[]) {
  const api: BackendApiHalf = {
    close: vi.fn(async () => {
      order.push("api.close");
    }),
  };
  const worker: BackendWorkerHalf = {
    close: vi.fn(async () => {
      order.push("worker.close");
    }),
  };
  return { api, worker };
}

describe("given the backend process hosts both applications", () => {
  describe("when it boots", () => {
    /** @scenario "The backend process starts the worker before the API" */
    it("starts the worker before the API", async () => {
      const order: string[] = [];
      const { api, worker } = halfSpies(order);

      const halves = await startBackend({
        env: {},
        write: () => void 0,
        fail: () => void 0,
        startWorker: async () => {
          order.push("worker.start");
          return worker;
        },
        startApi: async () => {
          order.push("api.start");
          return api;
        },
      });

      expect(order).toEqual(["worker.start", "api.start"]);
      expect(halves).toEqual({ api, worker });
    });

    /** @scenario "A half-started backend drains what it did start" */
    it("drains the worker when the API refuses to boot", async () => {
      const order: string[] = [];
      const { worker } = halfSpies(order);

      await expect(
        startBackend({
          env: {},
          write: () => void 0,
          fail: () => void 0,
          startWorker: async () => worker,
          startApi: async () => {
            throw new Error("no database");
          },
        }),
      ).rejects.toThrow("no database");
      expect(order).toEqual(["worker.close"]);
    });
  });

  describe("when it shuts down", () => {
    /** @scenario "Shutdown drains the worker before closing the API listener" */
    it("closes the worker before the API", async () => {
      const order: string[] = [];
      const { api, worker } = halfSpies(order);

      await drainBackend({ api, worker });

      expect(order).toEqual(["worker.close", "api.close"]);
    });

    /** @scenario "A stuck drain still closes the API listener" */
    it("closes the API even when the worker drain throws", async () => {
      const order: string[] = [];
      const { api } = halfSpies(order);
      const worker: BackendWorkerHalf = {
        close: async () => {
          throw new Error("queue wedged");
        },
      };

      await expect(drainBackend({ api, worker })).rejects.toThrow("queue wedged");
      expect(order).toEqual(["api.close"]);
    });
  });

  describe("when a hosted application reaches for the process", () => {
    /** @scenario "Neither hosted application owns the process's signals" */
    it("accepts and drops signal subscription, and routes exit to one owner", () => {
      const fail = vi.fn();
      const written: string[] = [];
      const host = embeddedBackendHost({
        env: { PORT: "5560" },
        write: (line) => void written.push(line),
        fail,
      });

      const listener = () => void 0;
      host.on("SIGTERM", listener);
      host.onUncaughtException(listener);
      host.off("SIGTERM", listener);
      host.write("boom\n");
      host.exit(3);

      expect(written).toEqual(["boom\n"]);
      expect(fail).toHaveBeenCalledWith(3);
      expect(host.env).toEqual({ PORT: "5560" });
    });
  });
});

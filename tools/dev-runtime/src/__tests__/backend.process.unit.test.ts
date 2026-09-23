import { describe, expect, it, vi } from "vitest";

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

    /** @scenario "One observability graph is set up and shared by both applications" */
    it("lets exactly one half set the telemetry SDK up", async () => {
      const { api, worker } = halfSpies([]);
      const asked: Record<string, boolean> = {};

      await startBackend({
        startWorker: async (options) => {
          asked["worker"] = options.ownsTelemetry;
          return worker;
        },
        startApi: async (options) => {
          asked["api"] = options.ownsTelemetry;
          return api;
        },
      });

      expect(asked).toEqual({ worker: true, api: false });
    });

    /** @scenario "A half-started backend drains what it did start" */
    it("drains the worker when the API refuses to boot", async () => {
      const order: string[] = [];
      const { worker } = halfSpies(order);

      await expect(
        startBackend({
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
    it("boots both halves as non-owners, so the launcher keeps the signals", async () => {
      const { api, worker } = halfSpies([]);
      const owners: boolean[] = [];

      await startBackend({
        startWorker: async (options) => {
          owners.push(options.ownsProcess);
          return worker;
        },
        startApi: async (options) => {
          owners.push(options.ownsProcess);
          return api;
        },
      });

      expect(owners).toEqual([false, false]);
    });
  });
});

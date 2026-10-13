import { EventEmitter } from "node:events";

import type { BackendApiHalf, BackendWorkerHalf } from "@langwatch/process/backend-host";
import { describe, expect, it, vi } from "vitest";

import { disposeGeneration, listenersAddedSince, snapshotListeners } from "../backend.process.ts";

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

describe("given a reload generation that attached process listeners while serving", () => {
  describe("when the next generation links and the old one is disposed", () => {
    /** @scenario "A reload disposes the previous generation before the next one boots" */
    it("drains the worker, then the api, then takes off only the listeners it left", async () => {
      const order: string[] = [];
      const { api, worker } = halfSpies(order);
      const emitter = new EventEmitter();
      const hostListener = () => {};
      emitter.on("exit", hostListener);
      const before = snapshotListeners(emitter);
      const leaked = () => order.push("leaked.fired");
      const closedByDrain = () => {};
      emitter.on("exit", leaked);
      emitter.on("beforeExit", closedByDrain);
      const added = listenersAddedSince({ emitter, before });
      worker.close = vi.fn(async () => {
        order.push("worker.close");
        emitter.off("beforeExit", closedByDrain);
        emitter.emit("exit");
      });
      const linkedByNext = () => {};
      emitter.on("exit", linkedByNext);

      const removed = await disposeGeneration({ halves: { api, worker }, emitter, added });

      expect(order).toEqual(["worker.close", "leaked.fired", "api.close"]);
      expect(removed).toBe(1);
      expect(emitter.listeners("exit")).toEqual([hostListener, linkedByNext]);
    });

    it("still takes the listeners off when the drain fails, and rethrows", async () => {
      const order: string[] = [];
      const { api, worker } = halfSpies(order);
      worker.close = vi.fn(async () => {
        throw new Error("redis did not quit");
      });
      const emitter = new EventEmitter();
      const before = snapshotListeners(emitter);
      emitter.on("exit", () => {});
      const added = listenersAddedSince({ emitter, before });

      await expect(disposeGeneration({ halves: { api, worker }, emitter, added })).rejects.toThrow(
        "redis did not quit",
      );
      expect(order).toEqual(["api.close"]);
      expect(emitter.listenerCount("exit")).toBe(0);
    });
  });
});

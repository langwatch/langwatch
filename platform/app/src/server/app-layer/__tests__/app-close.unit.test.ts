import { describe, expect, it, vi } from "vitest";
import { App } from "../app";
import type { AppDependencies } from "../dependencies";

/**
 * The App constructor only assigns fields, so an App can be built from the two
 * dependencies close() touches. It does spread `deps.commands.*` into several
 * of those fields, hence the proxy — it answers every command group with an
 * empty object so the test does not have to track that list as it grows.
 */
const emptyCommands = new Proxy(
  {},
  { get: () => ({}) },
) as AppDependencies["commands"];

function appWith({
  eventSourcingClose,
  closeables,
}: {
  eventSourcingClose?: () => Promise<void>;
  closeables: Array<{ name: string; close: () => Promise<void> }>;
}): App {
  return new App({
    commands: emptyCommands,
    _eventSourcing: eventSourcingClose
      ? { close: eventSourcingClose }
      : undefined,
    _gracefulCloseables: closeables,
  } as unknown as AppDependencies);
}

describe("App.close", () => {
  describe("given an event-sourcing consumer and connection closeables", () => {
    describe("when the App is closed", () => {
      /** @scenario The queue drain completes before any connection is closed */
      it("finishes the drain before closing any connection", async () => {
        const order: string[] = [];
        let drainFinished = false;

        const app = appWith({
          eventSourcingClose: async () => {
            order.push("drain:start");
            await new Promise((resolve) => setTimeout(resolve, 20));
            drainFinished = true;
            order.push("drain:end");
          },
          closeables: ["clickhouse", "redis", "prisma"].map((name) => ({
            name,
            close: async () => {
              // The assertion that matters: a connection must never be torn
              // down while the drain is still issuing statements over it.
              expect(drainFinished).toBe(true);
              order.push(name);
            },
          })),
        });

        await app.close();

        expect(order).toEqual([
          "drain:start",
          "drain:end",
          "clickhouse",
          "redis",
          "prisma",
        ]);
      });
    });
  });

  describe("given an event-sourcing consumer that throws while draining", () => {
    describe("when the App is closed", () => {
      /** @scenario A failing drain still releases the connections */
      it("still closes every connection", async () => {
        const closed: string[] = [];

        const app = appWith({
          eventSourcingClose: async () => {
            throw new Error("drain exploded");
          },
          closeables: ["clickhouse", "redis", "prisma"].map((name) => ({
            name,
            close: async () => {
              closed.push(name);
            },
          })),
        });

        await expect(app.close()).resolves.toBeUndefined();
        expect(closed).toEqual(["clickhouse", "redis", "prisma"]);
      });
    });
  });

  describe("given a closeable that throws", () => {
    describe("when the App is closed", () => {
      it("closes the remaining connections anyway", async () => {
        const closed: string[] = [];

        const app = appWith({
          closeables: [
            {
              name: "clickhouse",
              close: async () => {
                throw new Error("clickhouse close failed");
              },
            },
            {
              name: "redis",
              close: async () => {
                closed.push("redis");
              },
            },
          ],
        });

        await expect(app.close()).resolves.toBeUndefined();
        expect(closed).toEqual(["redis"]);
      });
    });
  });

  describe("given a drain that never finishes", () => {
    describe("when the App is closed", () => {
      /** @scenario A hung drain cannot hold the process open forever */
      it("gives up on the drain and releases the connections", async () => {
        vi.useFakeTimers();
        try {
          const closed: string[] = [];
          const app = appWith({
            eventSourcingClose: () => new Promise<void>(() => undefined),
            closeables: [
              {
                name: "clickhouse",
                close: async () => {
                  closed.push("clickhouse");
                },
              },
            ],
          });

          const closing = app.close();
          // A hung drain must not outlive the pod's termination grace period;
          // Kubernetes answers that with SIGKILL, which is the ungraceful
          // shutdown the ordering above exists to avoid.
          await vi.advanceTimersByTimeAsync(25_000);
          await closing;

          expect(closed).toEqual(["clickhouse"]);
        } finally {
          vi.useRealTimers();
        }
      });
    });
  });

  describe("given no event-sourcing consumer", () => {
    describe("when the App is closed", () => {
      it("closes the connections directly", async () => {
        const closed: string[] = [];
        const app = appWith({
          closeables: [
            {
              name: "prisma",
              close: async () => {
                closed.push("prisma");
              },
            },
          ],
        });

        await app.close();

        expect(closed).toEqual(["prisma"]);
      });
    });
  });
});

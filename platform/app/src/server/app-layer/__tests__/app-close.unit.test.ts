import { describe, expect, it, vi } from "vitest";
import { SHUTDOWN_BUDGET } from "~/server/shutdown/budget";
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
              // Recorded, NOT asserted here. App.close wraps every closeable in
              // a try/catch that logs, so an expect() throwing inside this
              // callback is swallowed and the test would pass anyway. Stamping
              // the observation into `order` and asserting outside is what
              // makes the drain-before-close guarantee actually enforceable.
              order.push(`${name}:drained=${drainFinished}`);
            },
          })),
        });

        await app.close();

        expect(order).toEqual([
          "drain:start",
          "drain:end",
          "clickhouse:drained=true",
          "redis:drained=true",
          "prisma:drained=true",
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
      // A timed-out drain is STILL RUNNING. Closing ClickHouse under it is
      // precisely the severing this method exists to prevent — the incident,
      // reproduced on the timeout path — so the connections are deliberately
      // left to process teardown. A drain that merely threw is different: it
      // has finished, and the case above proves those connections still close.
      /** @scenario A hung drain cannot hold the process open forever */
      it("stops waiting without severing the still-running drain", async () => {
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
          // Advancing by the shared budget rather than a literal keeps this
          // honest if the drain budget is ever retuned.
          await vi.advanceTimersByTimeAsync(SHUTDOWN_BUDGET.appCloseMs);
          await expect(closing).resolves.toBeUndefined();

          expect(closed).toEqual([]);
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

import { describe, expect, it, vi } from "vitest";
import { SHUTDOWN_BUDGET } from "~/server/shutdown/budget";
import { App, AppShutdownResources, type AppShutdownPhase } from "../app";
import type { AppDependencies } from "../dependencies";

/**
 * An App built with only what `close()` touches, plus whatever its constructor
 * insists on along the way.
 *
 * That second clause used to be unnecessary: the constructor only assigned
 * fields. It now composes the feature apps the App holds, which means it reads
 * a level into several dependency groups and calls `Object.assign` on another,
 * so those groups have to be present even though no shutdown test looks at
 * them. The proxy covers `deps.commands.*` the same way, so the list of
 * command groups can grow without this file tracking it.
 */
const emptyCommands = new Proxy({}, { get: () => ({}) }) as AppDependencies["commands"];

function appWith({
  eventSourcingClose,
  closeables,
}: {
  eventSourcingClose?: () => Promise<void>;
  closeables: Array<{
    phase?: AppShutdownPhase;
    name: string;
    close: () => Promise<void>;
  }>;
}): App {
  const shutdownResources = new AppShutdownResources();
  for (const closeable of closeables) {
    shutdownResources.register(closeable.phase ?? "database", closeable.name, closeable.close);
  }

  return new App({
    commands: emptyCommands,
    evaluations: {},
    // Nothing here is exercised by a shutdown test. They are present because
    // `App`'s constructor reaches a level in — `deps.traces.spans`,
    // `deps.gateway.webhookEvents` and so on — while composing the feature
    // apps it holds, and an absent branch is a TypeError before any test body
    // runs. The cast below is what lets this stay a shutdown fixture rather
    // than a whole composition root; it is also why the fixture went stale
    // silently as the constructor grew.
    traces: {},
    filters: {},
    gateway: {},
    codingAgents: {},
    _eventSourcing: eventSourcingClose ? { close: eventSourcingClose } : void 0,
    _shutdownResources: shutdownResources,
  } as unknown as AppDependencies);
}

function deferred(): {
  started: Promise<void>;
  start: () => void;
  promise: Promise<void>;
  resolve: () => void;
} {
  let start: (() => void) | undefined;
  const started = new Promise<void>((next) => {
    start = next;
  });
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });

  return {
    started,
    start: () => start?.(),
    promise,
    resolve: () => resolve?.(),
  };
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

  describe("given resources which depend on different roots", () => {
    describe("when the App is closed", () => {
      it("settles each shutdown phase before starting the next", async () => {
        const order: string[] = [];
        const subscriber = deferred();
        const redis = deferred();
        const clickhouse = deferred();
        const database = deferred();

        const app = appWith({
          closeables: [
            {
              phase: "subscriber",
              name: "subscriber",
              close: async () => {
                order.push("subscriber:start");
                subscriber.start();
                await subscriber.promise;
                order.push("subscriber:end");
              },
            },
            {
              phase: "redis",
              name: "redis",
              close: async () => {
                order.push("redis:start");
                redis.start();
                await redis.promise;
                order.push("redis:end");
              },
            },
            {
              phase: "clickhouse",
              name: "clickhouse",
              close: async () => {
                order.push("clickhouse:start");
                clickhouse.start();
                await clickhouse.promise;
                order.push("clickhouse:end");
              },
            },
            {
              phase: "database",
              name: "prisma",
              close: async () => {
                order.push("database:start");
                database.start();
                await database.promise;
                order.push("database:end");
              },
            },
          ],
        });

        const closing = app.close();
        expect(order).toEqual(["subscriber:start"]);

        subscriber.resolve();
        await redis.started;
        expect(order).toEqual(["subscriber:start", "subscriber:end", "redis:start"]);

        redis.resolve();
        await clickhouse.started;
        expect(order).toEqual([
          "subscriber:start",
          "subscriber:end",
          "redis:start",
          "redis:end",
          "clickhouse:start",
        ]);

        clickhouse.resolve();
        await database.started;
        expect(order).toEqual([
          "subscriber:start",
          "subscriber:end",
          "redis:start",
          "redis:end",
          "clickhouse:start",
          "clickhouse:end",
          "database:start",
        ]);

        database.resolve();
        await closing;
        expect(order).toEqual([
          "subscriber:start",
          "subscriber:end",
          "redis:start",
          "redis:end",
          "clickhouse:start",
          "clickhouse:end",
          "database:start",
          "database:end",
        ]);
      });

      it("continues with later phases when an earlier resource fails", async () => {
        const closed: string[] = [];
        const app = appWith({
          closeables: [
            {
              phase: "subscriber",
              name: "subscriber",
              close: async () => {
                throw new Error("subscriber close failed");
              },
            },
            {
              phase: "redis",
              name: "redis",
              close: async () => {
                closed.push("redis");
              },
            },
            {
              phase: "clickhouse",
              name: "clickhouse",
              close: async () => {
                closed.push("clickhouse");
              },
            },
            {
              phase: "database",
              name: "prisma",
              close: async () => {
                closed.push("prisma");
              },
            },
          ],
        });

        await expect(app.close()).resolves.toBeUndefined();
        expect(closed).toEqual(["redis", "clickhouse", "prisma"]);
      });

      it("closes each resource once when close is called repeatedly", async () => {
        const close = vi.fn(async () => void 0);
        const app = appWith({
          closeables: [{ phase: "database", name: "prisma", close }],
        });

        await Promise.all([app.close(), app.close()]);
        await app.close();

        expect(close).toHaveBeenCalledOnce();
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

          const closing = app.close({ terminating: true });
          // Advancing by the shared budget rather than a literal keeps this
          // honest if the drain budget is ever retuned.
          await vi.advanceTimersByTimeAsync(SHUTDOWN_BUDGET.appCloseMs);
          await expect(closing).resolves.toBeUndefined();

          expect(closed).toEqual([]);
        } finally {
          vi.useRealTimers();
        }
      });

      // resetApp() is the other caller and does NOT terminate: its own comment
      // says orphaned closeable handles keep vitest's fork worker from exiting
      // between files. Skipping the closeables there would leak Redis and
      // Prisma, so the skip is gated on `terminating` rather than applied to
      // every caller.
      /** @scenario A hung drain in a process that is not terminating still releases its handles */
      it("closes the connections anyway when the process is staying up", async () => {
        vi.useFakeTimers();
        try {
          const closed: string[] = [];
          const app = appWith({
            eventSourcingClose: () => new Promise<void>(() => undefined),
            closeables: [
              {
                name: "redis",
                close: async () => {
                  closed.push("redis");
                },
              },
            ],
          });

          const closing = app.close();
          await vi.advanceTimersByTimeAsync(SHUTDOWN_BUDGET.appCloseMs);
          await closing;

          expect(closed).toEqual(["redis"]);
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

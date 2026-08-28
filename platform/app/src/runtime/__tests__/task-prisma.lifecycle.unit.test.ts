import { describe, expect, it, vi } from "vitest";
import { runStandaloneTaskWithPrisma } from "../task-prisma.lifecycle";

function connection() {
  return { closeOnce: vi.fn(async () => undefined) };
}

describe("standalone task Prisma lifecycle", () => {
  it("composes, configures, executes, then closes App before Prisma", async () => {
    const events: string[] = [];
    const taskConnection = connection();

    await runStandaloneTaskWithPrisma({
      compose: () => {
        events.push("compose");
        return taskConnection;
      },
      configure: (value) => {
        expect(value).toBe(taskConnection);
        events.push("configure");
      },
      execute: async (value) => {
        expect(value).toBe(taskConnection);
        events.push("execute");
      },
      closeApp: async () => {
        events.push("app-close");
      },
      closePrisma: async () => {
        events.push("prisma-close");
      },
      reportCloseError: vi.fn(),
    });

    expect(events).toEqual(["compose", "configure", "execute", "app-close", "prisma-close"]);
  });

  it("preserves task failure while still closing App and Prisma", async () => {
    const taskFailure = new Error("task failed");
    const closeFailure = new Error("app close failed");
    const events: string[] = [];
    const reportCloseError = vi.fn();

    await expect(
      runStandaloneTaskWithPrisma({
        compose: () => connection(),
        configure: () => {
          events.push("configure");
        },
        execute: async () => {
          events.push("execute");
          throw taskFailure;
        },
        closeApp: async () => {
          events.push("app-close");
          throw closeFailure;
        },
        closePrisma: async () => {
          events.push("prisma-close");
        },
        reportCloseError,
      }),
    ).rejects.toThrow(taskFailure);

    expect(events).toEqual(["configure", "execute", "app-close", "prisma-close"]);
    expect(reportCloseError).toHaveBeenCalledWith({ target: "app", error: closeFailure });
  });

  it("gives an App-creating task the same configured connection without recomposition", async () => {
    const events: string[] = [];
    const taskConnection = connection();
    const initializeApp = vi.fn((input: { prismaConnection: typeof taskConnection }) => {
      events.push("app-compose");
      expect(input.prismaConnection).toBe(taskConnection);
    });

    await runStandaloneTaskWithPrisma({
      compose: () => {
        events.push("compose");
        return taskConnection;
      },
      configure: () => {
        events.push("configure");
      },
      execute: async (connection) => {
        initializeApp({ prismaConnection: connection });
        events.push("task");
      },
      closeApp: async () => {
        events.push("app-close");
      },
      closePrisma: async () => {
        events.push("prisma-close");
      },
      reportCloseError: vi.fn(),
    });

    expect(initializeApp).toHaveBeenCalledOnce();
    expect(events).toEqual([
      "compose",
      "configure",
      "app-compose",
      "task",
      "app-close",
      "prisma-close",
    ]);
  });

  it("closes an unconfigured connection when configuration rejects", async () => {
    const taskConnection = connection();
    const configurationFailure = new Error("already configured");

    await expect(
      runStandaloneTaskWithPrisma({
        compose: () => taskConnection,
        configure: () => {
          throw configurationFailure;
        },
        execute: async () => {
          throw new Error("must not execute");
        },
        closeApp: async () => {},
        closePrisma: async () => {
          throw new Error("must not use configured close");
        },
        reportCloseError: vi.fn(),
      }),
    ).rejects.toThrow(configurationFailure);

    expect(taskConnection.closeOnce).toHaveBeenCalledOnce();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveTasksConfig } from "../config.ts";
import { runTasks } from "../main.ts";

const calls = vi.hoisted(() => ({
  order: new Array<string>(),
  prisma: vi.fn<() => Promise<void>>(),
  lock: vi.fn<(url: string | undefined, run: () => Promise<void>) => Promise<void>>(),
}));

vi.mock("../prisma-migrate.ts", () => ({ prismaMigrate: calls.prisma }));
vi.mock("../clickhouse-migrate.ts", () => ({
  clickhouseMigrate: async () => {
    calls.order.push("clickhouse");
  },
}));
vi.mock("../lwql-provision.ts", () => ({
  lwqlProvision: async () => {
    calls.order.push("lwql");
  },
}));
vi.mock("../system-migrations-pass.ts", () => ({
  systemMigrationsPass: async () => {
    calls.order.push("system");
  },
}));
vi.mock("../migration-lock.ts", () => ({ withMigrationLock: calls.lock }));

const names = ["prisma-migrate", "clickhouse-migrate", "lwql-provision", "system-migrations-pass"];

function input() {
  return {
    config: resolveTasksConfig({ NODE_ENV: "test" }),
    // The boot seam builds these from resolved handles; a test supplies the
    // same shape, so the sequence is exercised without opening a connection.
    connections: {
      database: {
        client: undefined as never,
        hold: (run: () => Promise<void>) => calls.lock(void 0, run),
        close: async () => void 0,
      },
      redis: null,
    },
    environment: {},
    signal: new AbortController().signal,
  };
}

beforeEach(() => {
  calls.order.length = 0;
  calls.prisma.mockReset().mockImplementation(async () => {
    calls.order.push("prisma");
  });
  calls.lock.mockReset().mockImplementation(async (_url, run) => {
    calls.order.push("lock");
    try {
      await run();
    } finally {
      calls.order.push("unlock");
    }
  });
});

describe("given a migration sequence", () => {
  describe("when all tasks finish", () => {
    it("runs in argv order under one migration lock", async () => {
      await runTasks(names, input());
      expect(calls.order).toEqual(["lock", "prisma", "clickhouse", "lwql", "system", "unlock"]);
      expect(calls.lock).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the first migration fails", () => {
    it("stops the sequence and releases the lock", async () => {
      const failure = new Error("migration failed");
      calls.prisma.mockRejectedValueOnce(failure);
      await expect(runTasks(names, input())).rejects.toBe(failure);
      expect(calls.order).toEqual(["lock", "unlock"]);
    });
  });

  describe("when a name is unknown or missing", () => {
    it.each([{ argv: [] }, { argv: ["prisma-migrate", "unknown-task"] }])(
      "refuses before running any task: $argv",
      async ({ argv }) => {
        await expect(runTasks(argv, input())).rejects.toThrow("Available tasks:");
        expect(calls.prisma).not.toHaveBeenCalled();
        expect(calls.lock).not.toHaveBeenCalled();
      },
    );
  });

  describe("when only system migrations are requested", () => {
    it("leaves locking to the system migration leases", async () => {
      await runTasks(["system-migrations-pass"], input());
      expect(calls.order).toEqual(["system"]);
      expect(calls.lock).not.toHaveBeenCalled();
    });
  });

  describe("when cancellation arrives during a task", () => {
    it("stops before the next task and releases the migration lock", async () => {
      const controller = new AbortController();
      calls.prisma.mockImplementationOnce(async () => controller.abort());
      await expect(
        runTasks(names, { ...input(), signal: controller.signal }),
      ).rejects.toMatchObject({
        name: "AbortError",
      });
      expect(calls.order).toEqual(["lock", "unlock"]);
    });
  });
});

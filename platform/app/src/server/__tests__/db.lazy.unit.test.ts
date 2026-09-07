/**
 * specs/server/prisma-driver-adapter.feature — `~/server/db` sits on half
 * the server module graph, so importing it must not construct a client (and
 * with it a pg pool). The generated client is mocked so construction is
 * observable and nothing dials a database.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const constructed = vi.fn();

vi.mock("~/generated/prisma/client", () => ({
  PrismaClient: class {
    constructor(options: unknown) {
      constructed(options);
    }
    $extends() {
      return this;
    }
    $transaction() {
      return Promise.resolve();
    }
  },
}));

vi.mock("~/env.mjs", () => ({
  env: {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://user:pass@localhost:5432/db?schema=test",
  },
}));

describe("the prisma singleton", () => {
  beforeEach(() => {
    // The dev-mode cache survives module resets by design; drop it so each
    // test observes construction, not another suite's cached client.
    delete (globalThis as { prisma?: unknown }).prisma;
    constructed.mockClear();
    vi.resetModules();
  });

  describe("when the module is imported", () => {
    /** @scenario Importing the db module does not construct a client */
    it("constructs nothing until a property is first accessed", async () => {
      const { prisma } = await import("../db");
      expect(constructed).not.toHaveBeenCalled();

      void prisma.$transaction;
      expect(constructed).toHaveBeenCalledTimes(1);

      // Every later access reuses the one client.
      await prisma.$transaction(async () => undefined);
      void (prisma as unknown as Record<string, unknown>).project;
      expect(constructed).toHaveBeenCalledTimes(1);
    });
  });
});

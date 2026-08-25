import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => {
  const connections: Array<{ client: { project: object }; pool: object }> = [];
  const connect = vi.fn(() => {
    const connection = { client: { project: {} }, pool: {} };
    connections.push(connection);
    return connection;
  });

  return {
    connections,
    connect,
    shutdown: vi.fn(async () => {}),
  };
});

vi.mock("~/env.mjs", () => ({
  env: {
    DATABASE_URL: "postgresql://localhost/langwatch?connection_limit=4",
    NODE_ENV: "test",
  },
}));

vi.mock("@langwatch/prisma-client", () => {
  class PrismaQueryGuard {}

  return {
    PrismaQueryGuard,
    PrismaConfigService: {
      create: () => ({ resolve: (input: object) => input }),
    },
    PrismaConnectionService: {
      create: () => ({ connect: stubs.connect }),
    },
    PrismaShutdownService: {
      create: () => ({ shutdown: stubs.shutdown }),
    },
  };
});

import { closePrismaConnection, prisma } from "../db";

describe("Prisma process ownership", () => {
  beforeEach(async () => {
    await closePrismaConnection();
    stubs.connections.length = 0;
    stubs.connect.mockClear();
    stubs.shutdown.mockClear();
  });

  it("creates one connection lazily and replaces it only after shutdown", async () => {
    expect(stubs.connect).not.toHaveBeenCalled();

    void prisma.project;
    void prisma.project;

    expect(stubs.connect).toHaveBeenCalledTimes(1);
    const [first] = stubs.connections;

    await closePrismaConnection();

    expect(stubs.shutdown).toHaveBeenCalledWith(first);

    void prisma.project;

    expect(stubs.connect).toHaveBeenCalledTimes(2);
    expect(stubs.connections[1]).not.toBe(first);
  });
});

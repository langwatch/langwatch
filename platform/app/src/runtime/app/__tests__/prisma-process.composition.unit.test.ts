import { describe, expect, it, vi } from "vitest";

const composed = vi.hoisted(() => ({
  connect: vi.fn(() => ({ client: {}, pool: {} })),
  create: vi.fn(),
  resolve: vi.fn((configuration: unknown) => configuration),
}));

vi.mock("@langwatch/prisma-client", () => {
  class PrismaQueryGuard {}

  return {
    PrismaQueryGuard,
    PrismaConfigService: {
      create: () => ({ resolve: composed.resolve }),
    },
    PrismaConnectionService: {
      create: composed.create.mockImplementation(() => ({ connect: composed.connect })),
    },
  };
});

import { createProcessPrismaConnection } from "../prisma-process.composition";

describe("Prisma process composition", () => {
  it("builds one guarded connection from typed process configuration", () => {
    const connection = createProcessPrismaConnection({
      databaseUrl: "postgresql://localhost/langwatch",
      nodeEnv: "development",
    });

    expect(composed.resolve).toHaveBeenCalledWith({
      databaseUrl: "postgresql://localhost/langwatch",
      log: ["error", "warn"],
    });
    expect(composed.create).toHaveBeenCalledWith({ guard: expect.anything() });
    expect(composed.connect).toHaveBeenCalledWith({
      databaseUrl: "postgresql://localhost/langwatch",
      log: ["error", "warn"],
    });
    expect(connection).toEqual({ client: {}, pool: {} });
  });

  it("keeps the legacy non-development error-only logging policy", () => {
    createProcessPrismaConnection({
      databaseUrl: "postgresql://localhost/langwatch",
      nodeEnv: "production",
    });

    expect(composed.resolve).toHaveBeenLastCalledWith({
      databaseUrl: "postgresql://localhost/langwatch",
      log: ["error"],
    });
  });
});

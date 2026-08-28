import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PrismaShutdownService } from "@langwatch/prisma-client";
import { createProcessPrismaConnection } from "~/runtime/app/prisma-process.composition";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp, initializeDefaultApp } from "~/server/app-layer/presets";

import {
  adoptPrismaConnection,
  closePrismaConnection,
  configurePrismaConnection,
  getPrismaConnection,
  hasPrismaConnection,
  prisma,
} from "../db";

function composeConnection() {
  return createProcessPrismaConnection({
    databaseUrl: "postgresql://localhost/langwatch",
    nodeEnv: "test",
  });
}

describe("Prisma process ownership", () => {
  beforeEach(async () => {
    await resetApp();
    await closePrismaConnection();
  });

  afterEach(async () => {
    await resetApp();
    await closePrismaConnection();
    vi.restoreAllMocks();
  });

  it("does not construct a connection before executable composition", () => {
    expect(() => prisma.project).toThrow(
      "Prisma connection has not been composed for this process",
    );
    expect(hasPrismaConnection()).toBe(false);
  });

  it("exposes only the explicitly composed client's delegates and receiver-bound methods", () => {
    const composed = composeConnection();

    configurePrismaConnection(composed);

    expect(prisma.project).toBe(composed.client.project);
    expect(getPrismaConnection()).toBe(composed);
    expect("project" in prisma).toBe(true);
    expect(() => prisma.$extends({})).not.toThrow();
    expect(() => configurePrismaConnection(composed)).toThrow(
      "Prisma connection is already composed for this process",
    );
    expect(() => adoptPrismaConnection(composed)).not.toThrow();
  });

  it("shares one close operation and permits fresh composition after it settles", async () => {
    const composed = composeConnection();
    configurePrismaConnection(composed);

    const firstClose = closePrismaConnection();
    const concurrentClose = closePrismaConnection();

    expect(concurrentClose).toBe(firstClose);
    expect(() => configurePrismaConnection(composed)).toThrow(
      "Prisma connection is closing for this process",
    );

    await firstClose;

    expect(() => configurePrismaConnection(composeConnection())).not.toThrow();
  });

  it("allows fresh composition after a rejected close", async () => {
    const composed = composeConnection();
    const shutdownError = new Error("disconnect failed");
    const shutdown = vi
      .spyOn(PrismaShutdownService.prototype, "shutdown")
      .mockRejectedValueOnce(shutdownError);
    configurePrismaConnection(composed);

    await expect(closePrismaConnection()).rejects.toThrow(shutdownError);
    expect(hasPrismaConnection()).toBe(false);

    shutdown.mockRestore();
    await composed.closeOnce();

    expect(() => configurePrismaConnection(composeConnection())).not.toThrow();
  });

  it("lets test app composition close and rebuild its explicit connection", async () => {
    const firstApp = createTestApp();

    expect(hasPrismaConnection()).toBe(true);
    await firstApp.close();
    expect(hasPrismaConnection()).toBe(false);

    expect(() => createTestApp()).not.toThrow();
  });

  it("validates a supplied connection before returning an existing App", async () => {
    const composed = composeConnection();
    configurePrismaConnection(composed);
    const existingApp = createTestApp();
    globalForApp.__langwatch_app = existingApp;
    const differentConnection = composeConnection();

    try {
      expect(initializeDefaultApp({ prismaConnection: composed })).toBe(existingApp);
      expect(() => initializeDefaultApp({ prismaConnection: differentConnection })).toThrow(
        "A different Prisma connection is already composed for this process",
      );
    } finally {
      await differentConnection.closeOnce();
    }
  });

  it("orders production composition before the Prisma proxy and reset closes its graph", async () => {
    const presets = await readFile(
      fileURLToPath(new URL("../app-layer/presets.ts", import.meta.url)),
      "utf8",
    );
    const app = await readFile(
      fileURLToPath(new URL("../app-layer/app.ts", import.meta.url)),
      "utf8",
    );
    const productionStart = presets.indexOf("export function initializeDefaultApp");
    const production = presets.slice(
      productionStart,
      presets.indexOf("export function createTestApp"),
    );

    expect(production.indexOf("createAppConfigFromEnv")).toBeGreaterThan(-1);
    expect(production.indexOf("configurePrismaConnection")).toBeGreaterThan(
      production.indexOf("createAppConfigFromEnv"),
    );
    expect(production.indexOf("const prisma = globalPrisma")).toBeGreaterThan(
      production.indexOf("configurePrismaConnection"),
    );
    expect(app).toContain("await existing.close()");
  });
});

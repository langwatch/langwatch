import type { Logger } from "@langwatch/observability";
import type { PrismaPg } from "@prisma/adapter-pg";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PrismaConfigService } from "./config.ts";
import {
  forwardPrismaEvent,
  PrismaClientFactory,
  type PrismaClientFactoryInput,
  PrismaConnection,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "./connection.ts";
import { type PrismaDriverAdapter, PrismaDriverAdapterFactory } from "./driver-adapter.ts";
import type { PrismaClient } from "./generated/client.ts";
import {
  PrismaMigrationExecutor,
  type PrismaMigrationRequest,
  PrismaMigrationService,
} from "./migration.ts";
import { PrismaReadinessService } from "./readiness.ts";
import { PrismaSeed, PrismaSeedService } from "./seed.ts";
import { PrismaShutdownService } from "./shutdown.ts";

class RecordingGuard extends PrismaQueryGuard {
  readonly contexts: PrismaQueryContext[] = [];

  async execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    this.contexts.push(context);
    return next(context.args);
  }
}

class RecordingDriver extends PrismaDriverAdapterFactory {
  readonly create = vi.fn<(databaseUrl: string) => PrismaDriverAdapter>();

  constructor(result: PrismaDriverAdapter) {
    super();
    this.create.mockReturnValue(result);
  }
}

class RecordingClientFactory extends PrismaClientFactory {
  readonly create = vi.fn<(input: PrismaClientFactoryInput) => PrismaClient>();

  constructor(client: PrismaClient) {
    super();
    this.create.mockReturnValue(client);
  }
}

class RecordingMigrationExecutor extends PrismaMigrationExecutor {
  readonly requests: PrismaMigrationRequest[] = [];

  async deploy(request: PrismaMigrationRequest): Promise<void> {
    this.requests.push(request);
  }
}

class RecordingSeed extends PrismaSeed {
  readonly clients: PrismaClient[] = [];

  async run(client: PrismaClient): Promise<void> {
    this.clients.push(client);
  }
}

const fakePool = (end = vi.fn(async () => undefined)): Pool => ({ end }) as unknown as Pool;

const fakeClient = (overrides: Record<string, unknown> = {}): PrismaClient =>
  ({
    $disconnect: vi.fn(async () => undefined),
    $extends: vi.fn(function (this: PrismaClient) {
      return this;
    }),
    ...overrides,
  }) as unknown as PrismaClient;

const fakeLogger = () =>
  ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }) as unknown as Logger;

describe("explicit Prisma lifecycle", () => {
  it("constructs one guarded client and one externally owned pool", async () => {
    const pool = fakePool();
    const adapter = {} as PrismaPg;
    const client = fakeClient();
    const guard = new RecordingGuard();
    const driver = new RecordingDriver({ adapter, pool });
    const clientFactory = new RecordingClientFactory(client);
    const logger = fakeLogger();
    const config = PrismaConfigService.create().resolve({
      databaseUrl: "postgresql://localhost/langwatch",
      log: ["warn"],
    });

    const connection = PrismaConnectionService.create({
      guard,
      driverAdapter: driver,
      clientFactory,
      logger,
    }).connect(config);

    expect(connection.client).toBe(client);
    expect(connection.pool).toBe(pool);
    expect(driver.create).toHaveBeenCalledOnce();
    expect(driver.create).toHaveBeenCalledWith(config.databaseUrl);
    expect(clientFactory.create).toHaveBeenCalledWith({ adapter, log: ["warn"], logger });

    const extension = vi.mocked(client.$extends).mock.calls[0]?.[0] as {
      query: {
        $allModels: {
          $allOperations(input: {
            model: string;
            operation: string;
            args: unknown;
            query(args: unknown): Promise<unknown>;
          }): Promise<unknown>;
        };
      };
    };
    const query = vi.fn(async (args: unknown) => args);
    await extension.query.$allModels.$allOperations({
      model: "Project",
      operation: "findMany",
      args: { where: { projectId: "project-1" } },
      query,
    });
    expect(guard.contexts).toEqual([
      {
        model: "Project",
        action: "findMany",
        args: { where: { projectId: "project-1" } },
      },
    ]);
    expect(query).toHaveBeenCalledOnce();
  });

  it("routes every raw entrypoint through the same guard and delegated query", async () => {
    const pool = fakePool();
    const client = fakeClient();
    const guard = new RecordingGuard();
    const driver = new RecordingDriver({ adapter: {} as PrismaPg, pool });
    const clientFactory = new RecordingClientFactory(client);
    const config = PrismaConfigService.create().resolve({
      databaseUrl: "postgresql://localhost/langwatch",
      log: ["error"],
    });

    PrismaConnectionService.create({
      guard,
      driverAdapter: driver,
      clientFactory,
      logger: fakeLogger(),
    }).connect(config);

    const extension = vi.mocked(client.$extends).mock.calls[0]?.[0] as {
      query: {
        $executeRaw(input: {
          args: unknown;
          query(args: unknown): Promise<unknown>;
        }): Promise<unknown>;
        $executeRawUnsafe(input: {
          args: unknown;
          query(args: unknown): Promise<unknown>;
        }): Promise<unknown>;
        $queryRaw(input: {
          args: unknown;
          query(args: unknown): Promise<unknown>;
        }): Promise<unknown>;
        $queryRawUnsafe(input: {
          args: unknown;
          query(args: unknown): Promise<unknown>;
        }): Promise<unknown>;
      };
    };
    const query = vi.fn(async (args: unknown) => ({ args }));

    await extension.query.$queryRaw({ args: ["SELECT 1"], query });
    await extension.query.$queryRawUnsafe({ args: ["SELECT 2"], query });
    await extension.query.$executeRaw({ args: ["DELETE 1"], query });
    await extension.query.$executeRawUnsafe({ args: ["DELETE 2"], query });

    expect(guard.contexts).toEqual([
      { action: "queryRaw", args: ["SELECT 1"] },
      { action: "queryRaw", args: ["SELECT 2"] },
      { action: "executeRaw", args: ["DELETE 1"] },
      { action: "executeRaw", args: ["DELETE 2"] },
    ]);
    expect(query).toHaveBeenCalledTimes(4);
    expect(query).toHaveBeenLastCalledWith(["DELETE 2"]);
  });

  it("uses the sanctioned tenancy marker for readiness", async () => {
    const query = vi.fn(async () => [{ ready: 1 }]);
    const connection = PrismaConnection.create({
      client: fakeClient({ $queryRawUnsafe: query }),
      pool: fakePool(),
    });

    await PrismaReadinessService.create().check({ connection });

    expect(query).toHaveBeenCalledWith("-- @tenancy: prisma readiness probe\nSELECT 1 AS ready");
  });

  it("disconnects the client and pool exactly once", async () => {
    const order: string[] = [];
    const client = fakeClient({
      $disconnect: vi.fn(async () => {
        order.push("client");
      }),
    });
    const end = vi.fn(async () => {
      order.push("pool");
    });
    const connection = PrismaConnection.create({ client, pool: fakePool(end) });
    const shutdown = PrismaShutdownService.create();

    await Promise.all([shutdown.shutdown(connection), shutdown.shutdown(connection)]);

    expect(client.$disconnect).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledOnce();
    expect(order).toEqual(["client", "pool"]);
  });

  it("still closes the pool when Prisma disconnection fails", async () => {
    const end = vi.fn(async () => undefined);
    const connection = PrismaConnection.create({
      client: fakeClient({
        $disconnect: vi.fn(async () => {
          throw new Error("disconnect failed");
        }),
      }),
      pool: fakePool(end),
    });

    await expect(PrismaShutdownService.create().shutdown(connection)).rejects.toThrow(
      "disconnect failed",
    );
    expect(end).toHaveBeenCalledOnce();
  });

  it("passes explicit configuration and canonical paths to migration execution", async () => {
    const executor = new RecordingMigrationExecutor();
    await PrismaMigrationService.create({ executor }).deploy({
      databaseUrl: "postgresql://localhost/langwatch",
    });

    expect(executor.requests).toHaveLength(1);
    expect(executor.requests[0]?.databaseUrl).toBe("postgresql://localhost/langwatch");
    expect(executor.requests[0]?.schemaPath.pathname).toMatch(
      /packages\/prisma-client\/prisma\/schema\.prisma$/,
    );
    expect(executor.requests[0]?.migrationsPath.pathname).toMatch(
      /packages\/prisma-client\/prisma\/migrations\/$/,
    );
  });

  it("runs product-owned seed behavior against the owned client", async () => {
    const client = fakeClient();
    const connection = PrismaConnection.create({ client, pool: fakePool() });
    const seed = new RecordingSeed();

    await PrismaSeedService.create().run({ connection, seed });

    expect(seed.clients).toEqual([client]);
  });

  describe("forwardPrismaEvent", () => {
    it("lands an emitted error event on the logger as one structured call", () => {
      const logger = fakeLogger();
      const timestamp = new Date("2026-09-09T00:00:00.000Z");

      forwardPrismaEvent({
        logger,
        level: "error",
        event: { target: "postgres.query", message: "connection reset", timestamp },
      });

      expect(logger.error).toHaveBeenCalledOnce();
      expect(logger.error).toHaveBeenCalledWith(
        { target: "postgres.query", message: "connection reset", timestamp },
        "prisma error",
      );
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
      expect(logger.debug).not.toHaveBeenCalled();
    });

    it("lands a query event on the logger at debug, keyed by its SQL text", () => {
      const logger = fakeLogger();
      const timestamp = new Date("2026-09-09T00:00:00.000Z");

      forwardPrismaEvent({
        logger,
        level: "query",
        event: { target: "postgres.query", query: "SELECT 1", params: "[]", duration: 4, timestamp },
      });

      expect(logger.debug).toHaveBeenCalledWith(
        { target: "postgres.query", message: "SELECT 1", timestamp },
        "prisma query",
      );
    });
  });
});

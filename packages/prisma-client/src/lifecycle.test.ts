import type { PrismaPg } from "@prisma/adapter-pg";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PrismaConfigService } from "./config";
import {
  PrismaClientFactory,
  type PrismaClientFactoryInput,
  PrismaConnection,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "./connection";
import {
  type PrismaDriverAdapter,
  PrismaDriverAdapterFactory,
} from "./driver-adapter";
import type { PrismaClient } from "./generated/client";
import {
  PrismaMigrationExecutor,
  type PrismaMigrationRequest,
  PrismaMigrationService,
} from "./migration";
import { PrismaReadinessService } from "./readiness";
import { PrismaSeed, PrismaSeedService } from "./seed";
import { PrismaShutdownService } from "./shutdown";

class RecordingGuard extends PrismaQueryGuard {
  readonly contexts: PrismaQueryContext[] = [];

  async execute(
    context: PrismaQueryContext,
    next: PrismaQueryExecutor,
  ): Promise<unknown> {
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

const fakePool = (end = vi.fn(async () => undefined)): Pool =>
  ({ end }) as unknown as Pool;

const fakeClient = (overrides: Record<string, unknown> = {}): PrismaClient =>
  ({
    $disconnect: vi.fn(async () => undefined),
    $extends: vi.fn(function (this: PrismaClient) {
      return this;
    }),
    ...overrides,
  }) as unknown as PrismaClient;

describe("explicit Prisma lifecycle", () => {
  it("constructs one guarded client and one externally owned pool", async () => {
    const pool = fakePool();
    const adapter = {} as PrismaPg;
    const client = fakeClient();
    const guard = new RecordingGuard();
    const driver = new RecordingDriver({ adapter, pool });
    const clientFactory = new RecordingClientFactory(client);
    const config = PrismaConfigService.create().resolve({
      databaseUrl: "postgresql://localhost/langwatch",
      log: ["warn"],
    });

    const connection = PrismaConnectionService.create({
      guard,
      driverAdapter: driver,
      clientFactory,
    }).connect(config);

    expect(connection.client).toBe(client);
    expect(connection.pool).toBe(pool);
    expect(driver.create).toHaveBeenCalledOnce();
    expect(driver.create).toHaveBeenCalledWith(config.databaseUrl);
    expect(clientFactory.create).toHaveBeenCalledWith({ adapter, log: ["warn"] });

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

  it("uses the sanctioned tenancy marker for readiness", async () => {
    const query = vi.fn(async () => [{ ready: 1 }]);
    const connection = PrismaConnection.create({
      client: fakeClient({ $queryRawUnsafe: query }),
      pool: fakePool(),
    });

    await PrismaReadinessService.create().check({ connection });

    expect(query).toHaveBeenCalledWith(
      "-- @tenancy: prisma readiness probe\nSELECT 1 AS ready",
    );
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

    await expect(
      PrismaShutdownService.create().shutdown(connection),
    ).rejects.toThrow("disconnect failed");
    expect(end).toHaveBeenCalledOnce();
  });

  it("passes explicit configuration and canonical paths to migration execution", async () => {
    const executor = new RecordingMigrationExecutor();
    await PrismaMigrationService.create({ executor }).deploy({
      databaseUrl: "postgresql://localhost/langwatch",
    });

    expect(executor.requests).toHaveLength(1);
    expect(executor.requests[0]?.databaseUrl).toBe(
      "postgresql://localhost/langwatch",
    );
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
});

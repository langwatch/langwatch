import type { Logger } from "@langwatch/observability";
import {
  PrismaConfigService,
  type PrismaConnection,
  PrismaConnectionService,
  PrismaShutdownService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { ResourceScope } from "@langwatch/kernel";
import type { WorkerDatabaseConfig } from "../config/worker.config.ts";

export type WorkerDatabaseInfrastructureOptions = {
  resources: ResourceScope;
  database: WorkerDatabaseConfig;
  /** Decides the client's log levels, exactly as it does in the application. */
  nodeEnvironment: string;
  /** The process logger every Prisma client event is forwarded to. */
  logger: Logger;
};

/**
 * Worker-owned Postgres: one guarded Prisma client per process. Unlike the API, there is no
 * absence arm — boot fails if the database is missing.
 */
export class WorkerDatabaseInfrastructure {
  static create(options: WorkerDatabaseInfrastructureOptions): WorkerDatabaseInfrastructure {
    const databaseUrl = options.database.url?.trim();
    if (!databaseUrl) {
      throw new Error(
        "Worker database infrastructure requires a configured Postgres connection: set DATABASE_URL.",
      );
    }

    const configuration = PrismaConfigService.create().resolve({
      databaseUrl,
      log: options.nodeEnvironment === "development" ? ["error", "warn"] : ["error"],
    });
    const connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: options.logger,
    }).connect(configuration);

    const infrastructure = new WorkerDatabaseInfrastructure(connection);
    options.resources.own("worker database infrastructure", () => infrastructure.close());
    return infrastructure;
  }

  private constructor(readonly connection: PrismaConnection) {}

  /**
   * Releases the client and then the pool, in that order. No local
   * once-only latch: {@link PrismaShutdownService} already memoises through
   * `closeOnce`, so a second latch here would only hide where it lives.
   */
  close(): Promise<void> {
    return PrismaShutdownService.create().shutdown(this.connection);
  }
}

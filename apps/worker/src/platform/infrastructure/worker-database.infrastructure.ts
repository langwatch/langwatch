import {
  PrismaConfigService,
  type PrismaConnection,
  PrismaConnectionService,
  PrismaShutdownService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { ResourceScope } from "@langwatch/runtime-composition";
import type { WorkerDatabaseConfig } from "../config/worker.config";

export type WorkerDatabaseInfrastructureOptions = {
  resources: ResourceScope;
  database: WorkerDatabaseConfig;
  /** Decides the client's log levels, exactly as it does in the application. */
  nodeEnvironment: string;
};

/**
 * Worker-owned Postgres construction: one guarded Prisma client per process,
 * and its disconnection.
 *
 * There is no unguarded path through this class, and that is its point. The
 * options carry a connection string and a NODE_ENV and nothing else — no
 * guard, no client, no factory — so the only client it can build is the one
 * {@link PrismaConnectionService} builds with {@link PrismaTenancyGuardService}
 * wrapped around every operation. A background process runs unattended across
 * every tenant, which is exactly where an unguarded query does the most damage.
 *
 * UNLIKE THE API, THERE IS NO ABSENCE ARM. An API process without a database
 * still serves its lifecycle surface; a worker without one has no process
 * store, so it can neither lease a job nor advance a process manager. It
 * refuses at boot instead of coming up green with every job failing
 * individually.
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
    }).connect(configuration);

    const infrastructure = new WorkerDatabaseInfrastructure(connection);
    options.resources.own("worker database infrastructure", () => infrastructure.close());
    return infrastructure;
  }

  private constructor(readonly connection: PrismaConnection) {}

  /**
   * Releases the client and then the pool, in that order.
   *
   * No local once-only latch: {@link PrismaShutdownService} closes the
   * connection through `closeOnce`, which already memoises, so a second latch
   * here would guard nothing and hide where the guarantee actually lives.
   */
  close(): Promise<void> {
    return PrismaShutdownService.create().shutdown(this.connection);
  }
}

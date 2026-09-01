import {
  PrismaConfigService,
  type PrismaConnection,
  PrismaConnectionService,
  PrismaShutdownService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { ResourceScope } from "@langwatch/runtime-composition";
import type { ApiDatabaseConfigResolution } from "../config/api.config";

export type ApiDatabaseInfrastructureOptions = {
  resources: ResourceScope;
  database: ApiDatabaseConfigResolution;
  /** Decides the client's log levels, exactly as it does in the legacy app. */
  nodeEnvironment: string;
};

/** Reports the composition decision an unconfigured database would otherwise hide. */
export abstract class ApiDatabaseAbsenceReportPort {
  abstract absent(): void;
}

/**
 * API-owned Postgres construction: one guarded Prisma client per process, and
 * its disconnection.
 *
 * There is no unguarded path through this class, and that is its point. The
 * options carry a connection string and a NODE_ENV and nothing else — no
 * guard, no client, no factory — so the only client it can build is the one
 * {@link PrismaConnectionService} builds with {@link PrismaTenancyGuardService}
 * wrapped around every operation. A caller cannot ask for a client that skips
 * the multitenancy, organization and mass-delete guards, because there is no
 * argument with which to ask.
 *
 * Composing the client is NOT composing the product services. What it unlocks
 * is the seam below them: a packaged `Postgres*Adapter` takes a typed
 * `PrismaClient` from a composition root, and this is the composition root's
 * typed client. Which of those adapters this process mounts is decided by the
 * ports they still need, not by the connection.
 */
export class ApiDatabaseInfrastructure {
  /**
   * Composes the client only when a database is configured.
   *
   * The API process serves its lifecycle surface without one, so an absent
   * `DATABASE_URL` is a smaller process rather than a dead one, and the caller
   * is told it happened. A database that IS configured and unusable still
   * fails at boot: `create` refuses a blank string rather than handing back a
   * client whose first query is the one that discovers the problem.
   */
  static tryCreate(
    options: ApiDatabaseInfrastructureOptions & { report?: ApiDatabaseAbsenceReportPort },
  ): ApiDatabaseInfrastructure | undefined {
    if (!options.database.url?.trim()) {
      options.report?.absent();
      return undefined;
    }
    return ApiDatabaseInfrastructure.create(options);
  }

  static create(options: ApiDatabaseInfrastructureOptions): ApiDatabaseInfrastructure {
    const databaseUrl = options.database.url?.trim();
    if (!databaseUrl) {
      throw new Error(
        "API database infrastructure requires a configured Postgres connection: set DATABASE_URL.",
      );
    }

    const configuration = PrismaConfigService.create().resolve({
      databaseUrl,
      log: options.nodeEnvironment === "development" ? ["error", "warn"] : ["error"],
    });
    const connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
    }).connect(configuration);

    const infrastructure = new ApiDatabaseInfrastructure(connection);
    options.resources.own("API database infrastructure", () => infrastructure.close());
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

import {
  PrismaConfigService,
  type PrismaConnection,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { withQueryTiming } from "~/server/dbSlowQueryWarning";

export interface PrismaProcessConfiguration {
  databaseUrl: string;
  nodeEnv: string;
}

/**
 * The packaged tenancy guard with this process's slow-query reporting around
 * it, which is the whole of what the app adds to the shared policy.
 *
 * The timing stays here because the budget it reports against is read from the
 * environment per call (`POSTGRES_SLOW_QUERY_MS`), and nothing below a
 * composition root reads the environment. The order the client sees is
 * unchanged: timing, then mass-delete, then project, then organization.
 */
export class AppPrismaQueryGuard extends PrismaQueryGuard {
  private readonly tenancy = PrismaTenancyGuardService.create();

  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return withQueryTiming({
      params: {
        ...(context.model === void 0 ? {} : { model: context.model }),
        action: context.action,
        args: context.args,
      },
      run: () => this.tenancy.execute(context, next),
    });
  }
}

/**
 * Creates the one guarded Prisma/Postgres connection for an executable process.
 * Readiness probes and migrations remain separate executable entrypoints.
 */
export function createProcessPrismaConnection(
  configuration: PrismaProcessConfiguration,
): PrismaConnection {
  const resolved = PrismaConfigService.create().resolve({
    databaseUrl: configuration.databaseUrl,
    log: configuration.nodeEnv === "development" ? ["error", "warn"] : ["error"],
  });

  return PrismaConnectionService.create({
    guard: new AppPrismaQueryGuard(),
  }).connect(resolved);
}

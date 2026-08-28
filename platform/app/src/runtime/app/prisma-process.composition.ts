import {
  PrismaConfigService,
  type PrismaConnection,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import { withQueryTiming } from "~/server/dbSlowQueryWarning";
import { guardEnMasse } from "~/utils/dbMassDeleteProtection";
import type { GuardNext, GuardParams } from "~/utils/dbGuardMiddleware";
import { guardProjectId } from "~/utils/dbMultiTenancyProtection";
import { guardOrganizationId } from "~/utils/dbOrganizationIdProtection";

export interface PrismaProcessConfiguration {
  databaseUrl: string;
  nodeEnv: string;
}

/** Preserves the legacy Prisma middleware sequence at the composed client. */
export class AppPrismaQueryGuard extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    const params: GuardParams = {
      ...(context.model === void 0 ? {} : { model: context.model }),
      action: context.action,
      args: context.args,
    };
    const run: GuardNext = (current) =>
      guardProjectId(current, (projectGuarded) =>
        guardOrganizationId(projectGuarded, (organizationGuarded) =>
          next(organizationGuarded.args),
        ),
      );
    return withQueryTiming({ params, run: () => guardEnMasse(params, run) });
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

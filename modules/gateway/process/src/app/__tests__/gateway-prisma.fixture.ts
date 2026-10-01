import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

export function createGatewayTestPrismaConnection(databaseUrl: string) {
  return PrismaConnectionService.create({
    guard: new AllowTestQueries(),
    logger: createLogger("langwatch:gateway:test:prisma"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
}

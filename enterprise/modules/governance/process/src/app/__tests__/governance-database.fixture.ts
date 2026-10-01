import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import { createTestLogger } from "@langwatch/test-harness";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

export function createGovernanceTestConnection(databaseUrl: string) {
  const { logger } = createTestLogger();
  const connection = PrismaConnectionService.create({ guard: new AllowTestQueries(), logger });
  const config = PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] });

  return connection.connect(config);
}

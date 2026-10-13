import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import { createTestLogger } from "@langwatch/test-harness";

/** These suites write the rows they read, so no tenancy guard stands in front of them. */
class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

/** The dedicated test database, or undefined where none is configured and the suite skips. */
export const TEST_DATABASE_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

export function createLicensingTestConnection(databaseUrl: string) {
  const { logger } = createTestLogger();
  const connection = PrismaConnectionService.create({ guard: new AllowTestQueries(), logger });
  return connection.connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
}

import { skipTenantCheck } from "@langwatch/prisma-client";

import {
  LangWatchQLPostgresRepository,
  type LwqlProvisioningDatabase,
} from "../langwatch-ql-postgres.repository.ts";

const CATALOG = skipTenantCheck({
  // Provisions LangWatchQL catalog objects shared across every tenant, not scoped to one.
  SKIP_TENANT_CHECK: true,
}).sql;
const BOOT_LOCK = skipTenantCheck({
  // The self-provision boot lock and its session setting are global, with no tenant scope.
  SKIP_TENANT_CHECK: true,
}).sql;

export class PrismaLangWatchQLPostgresRepository extends LangWatchQLPostgresRepository {
  private constructor(private readonly database: LwqlProvisioningDatabase) {
    super();
  }

  static create(database: LwqlProvisioningDatabase): PrismaLangWatchQLPostgresRepository {
    return new PrismaLangWatchQLPostgresRepository(database);
  }

  async runStatements(statements: readonly string[]): Promise<void> {
    for (const statement of statements) {
      await this.database.$executeRawUnsafe(`${CATALOG}\n${statement}`);
    }
  }

  withAdvisoryLock<T>({
    key,
    timeoutMs,
    maxWaitMs,
    fn,
  }: {
    key: string;
    timeoutMs: number;
    maxWaitMs: number;
    fn: () => Promise<T>;
  }): Promise<T> {
    return this.database.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `${BOOT_LOCK}SELECT pg_advisory_xact_lock(hashtextextended('${key}', 0))`,
        );
        await tx.$executeRawUnsafe(`${BOOT_LOCK}SET LOCAL idle_in_transaction_session_timeout = 0`);
        return fn();
      },
      { timeout: timeoutMs, maxWait: maxWaitMs },
    );
  }
}

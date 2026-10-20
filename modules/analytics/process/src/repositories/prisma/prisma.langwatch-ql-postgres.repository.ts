import { skipTenantCheck } from "@langwatch/prisma-client";
import { z } from "zod";

import {
  LangWatchQLPostgresRepository,
  type LwqlPostgresViewFound,
  type LwqlProvisioningDatabase,
} from "../langwatch-ql-postgres.repository.ts";

const CATALOG = skipTenantCheck({
  // Provisions LangWatchQL catalog objects shared across every tenant, not scoped to one.
  SKIP_TENANT_CHECK: true,
}).sql;
const approvedViewRowsSchema = z.array(z.object({ view: z.string(), granted: z.boolean() }));
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

  /** `has_table_privilege` is strict, so an absent role reads as not granted, never an error. */
  async findApprovedViews({
    schema,
    role,
    views,
  }: {
    schema: string;
    role: string;
    views: readonly string[];
  }): Promise<LwqlPostgresViewFound[]> {
    const rows = await this.database.$queryRawUnsafe(
      `${CATALOG}\nSELECT c.relname AS view, ` +
        `coalesce(has_table_privilege(r.oid, c.oid, 'SELECT'), false) AS granted ` +
        `FROM pg_class c ` +
        `JOIN pg_namespace n ON n.oid = c.relnamespace ` +
        `LEFT JOIN pg_roles r ON r.rolname = $2 ` +
        `WHERE n.nspname = $1 AND c.relkind = 'v' AND c.relname = ANY($3::text[])`,
      schema,
      role,
      [...views],
    );
    return approvedViewRowsSchema.parse(rows);
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

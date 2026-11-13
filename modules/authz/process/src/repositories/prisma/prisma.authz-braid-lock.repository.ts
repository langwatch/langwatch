import { skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { AuthzBraidLockRepository } from "../authz-braid-lock.repository.ts";

/** Holds the lock across the write and its projection wait; Prisma's 5s default is too short. */
const BRAID_LOCK_TIMEOUT_MS = 60_000;
const BRAID_LOCK_MAX_WAIT_MS = 10_000;

/** A transaction-scoped advisory lock keyed by the reader, as governance's aggregate reconcile. */
export class PrismaAuthzBraidLockRepository extends AuthzBraidLockRepository {
  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  static create({ prisma }: { prisma: PrismaClient }): PrismaAuthzBraidLockRepository {
    return new PrismaAuthzBraidLockRepository(prisma);
  }

  async withReaderLock<T>({
    readerProjectId,
    write,
  }: {
    readerProjectId: string;
    write: () => Promise<T>;
  }): Promise<T> {
    return this.prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRaw` ${skipTenantCheck({
          // Advisory-lock helper, the key names one braid reader project.
          SKIP_TENANT_CHECK: true,
        })}
SELECT pg_advisory_xact_lock(hashtextextended(${`authz-braid-reader:${readerProjectId}`}, 0))`;
        return write();
      },
      { timeout: BRAID_LOCK_TIMEOUT_MS, maxWait: BRAID_LOCK_MAX_WAIT_MS },
    );
  }
}

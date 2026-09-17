import { AsyncLocalStorage } from "node:async_hooks";
import type { BetterAuthOptions } from "better-auth";
import type { DBAdapter } from "better-auth/adapters";
import { prismaAdapter } from "better-auth/adapters/prisma";
import type { Prisma, PrismaClient } from "~/generated/prisma/client";

/** Only the current native callback transaction may supply SCIM link evidence. */
export const identityStorageTransactions =
  new AsyncLocalStorage<Prisma.TransactionClient>();

/**
 * Better Auth's callback and the SCIM selection reads share one native
 * transaction. Event-store writes and the identity ports constructed against
 * the base client retain their existing, separate transaction boundaries.
 */

/** Runs `work` against an engine bound to an open Postgres transaction. */
export type PostgresTransactionRunner = <R>(
  work: (legacyEngine: (options: BetterAuthOptions) => DBAdapter) => Promise<R>,
) => Promise<R>;

/** The callback holds its row lock across assertion reads and event-store I/O. */
const TRANSACTION_BUDGET = { maxWait: 5_000, timeout: 20_000 } as const;

export function postgresTransactionOver(
  prisma: PrismaClient,
): PostgresTransactionRunner {
  return (work) =>
    prisma.$transaction(
      (transactional) =>
        identityStorageTransactions.run(transactional, () =>
          work(prismaAdapter(transactional, { provider: "postgresql" })),
        ),
      TRANSACTION_BUDGET,
    );
}

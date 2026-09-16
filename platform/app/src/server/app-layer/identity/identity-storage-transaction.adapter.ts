import type { BetterAuthOptions } from "better-auth";
import type { DBAdapter } from "better-auth/adapters";
import { prismaAdapter } from "better-auth/adapters/prisma";
import type { PrismaClient } from "~/generated/prisma/client";

/**
 * The identity storage adapter's one real transaction.
 *
 * A Prisma interactive transaction with better-auth's own engine rebuilt over
 * the transactional client, so everything better-auth issues inside the
 * callback runs on it. `@better-auth/sso` will not resolve a user at all
 * unless the adapter declares native transaction support, and what it wants
 * the transaction FOR is the provider-row lock that makes the
 * identity-boundary check mean something.
 *
 * ITS OWN FILE, and not a few lines in `runtime.ts`, because opening a
 * transaction is a query: `identity-service-layering` spells
 * `prisma.$transaction(` into the pattern it scans for, and the composition
 * root is explicitly not exempt — "the composition root holds the client to
 * construct repositories; a query in it is the same violation as a query
 * anywhere else."
 *
 * WHAT IT DOES NOT COVER, which is as important as what it does. Only the
 * Postgres half: everything better-auth issues through the adapter onto the
 * legacy engine while the callback runs — `SsoProvider`, `User`, `Session`,
 * `Account`. NOT the event store, which is a different database entirely, and
 * not the Postgres rows the identity ports hold (`Identifier`,
 * `AccountCredential`), which are constructed against the base client and
 * stay on it.
 */

/** Runs `work` against an engine bound to an open Postgres transaction. */
export type PostgresTransactionRunner = <R>(
  work: (legacyEngine: (options: BetterAuthOptions) => DBAdapter) => Promise<R>,
) => Promise<R>;

/**
 * The budget is raised off Prisma's defaults because of what runs inside the
 * callback rather than out of caution. The single sign-on link holds the
 * transaction across the provider-row lock, the assertion decision's own
 * reads and the account write — and, for a user on the identity branch, an
 * append to the event store, which is a network hop to another database.
 * Five seconds is Prisma's default for a transaction that only writes rows;
 * this one waits on work that is not all local, and a timeout here fails a
 * customer's sign-in.
 */
const TRANSACTION_BUDGET = { maxWait: 5_000, timeout: 20_000 } as const;

export function postgresTransactionOver(
  prisma: PrismaClient,
): PostgresTransactionRunner {
  return (work) =>
    prisma.$transaction(
      (transactional) =>
        work(prismaAdapter(transactional, { provider: "postgresql" })),
      TRANSACTION_BUDGET,
    );
}

import type { BetterAuthOptions } from "better-auth";
import type { IdentityHeadsRepository } from "../identity-heads.repository";
import type { IdentityUsersRepository } from "../identity-users.repository";
import { type IdentityService, newIdentityCommandId } from "../identity.service";
import {
  attachCeremonyForAccountCreate,
  detachBeforeAccountDelete,
} from "./account-ceremonies";
import { type AdapterContext, type DbAdapter, pinnedToIds } from "./context";
import { routeWrite } from "./routing";
import { guardTransaction } from "./transaction-guard";
import {
  eraseBeforeUserDelete,
  mintUserHashKeyAfterCreate,
} from "./user-ceremonies";

export interface IdentityDatabaseDeps {
  /** The row engine: the stock adapter factory the app constructs (the
   *  prismaAdapter over its Prisma client). The facade never sees Prisma. */
  base: (options: BetterAuthOptions) => DbAdapter;
  heads: Pick<IdentityHeadsRepository, "findIdentifierIdForAccount">;
  users: IdentityUsersRepository;
  identity: Pick<
    IdentityService,
    "attachIdentifier" | "detachIdentifier" | "eraseUser"
  >;
  /** The per-user write gate (the app's; ADR-101 §2). */
  isLatched: (args: { userId: string }) => Promise<boolean>;
  now?: () => number;
  newCommandId?: () => string;
}

/**
 * The identity adapter (ADR-101 §2, R10): better-auth's `database` contract
 * implemented as OUR adapter — a routing facade whose row engine is the
 * stock prismaAdapter. better-auth still never writes the database except
 * through this seam; what the facade adds is the per-(model, operation)
 * ROUTING TABLE (routing.ts) and the per-user write gate:
 *
 *   - Every WRITE is looked up in the routing table. An unrouted write —
 *     a new better-auth model or operation nobody has classified — throws,
 *     loudly, on first use; the app's coverage test pins the full current
 *     surface so the failure lands in CI before it lands in production.
 *   - `protocol` writes delegate straight to the row engine: byte-identical
 *     to stock behavior, no events (R12 — session rows, token refreshes,
 *     verification bookkeeping).
 *   - `domain` writes run the identity ceremony FIRST for latched users
 *     (guards veto before any row exists — a refused ceremony refuses the
 *     protocol write too), then perform the row write. For unlatched users
 *     the row write happens identically and no events are emitted; the
 *     backfill adopts the rows on its next pass. The gate ships CLOSED for
 *     everyone. The ceremonies live in account-ceremonies.ts and
 *     user-ceremonies.ts.
 *   - READS delegate untouched.
 *
 * Writes inside `transaction(...)` are routing-VALIDATED but never emit
 * ceremonies (transaction-guard.ts).
 */
export function createIdentityDatabase(
  deps: IdentityDatabaseDeps,
): (options: BetterAuthOptions) => DbAdapter {
  return (options: BetterAuthOptions): DbAdapter => {
    const base = deps.base(options);
    const ctx: AdapterContext = {
      base,
      heads: deps.heads,
      users: deps.users,
      identity: deps.identity,
      isLatched: deps.isLatched,
      now: deps.now ?? Date.now,
      newCommandId: deps.newCommandId ?? newIdentityCommandId,
    };
    return {
      ...base,
      create: (args) => createRouted(ctx, args) as never,
      update: async (args) => {
        routeWrite(args.model, "update");
        return base.update(args) as never;
      },
      updateMany: async (args) => {
        routeWrite(args.model, "updateMany");
        return base.updateMany(args);
      },
      delete: async (args) => {
        const detachedIds = await detachBeforeAccountDelete(ctx, {
          operation: "delete",
          args,
        });
        const erasedIds = await eraseBeforeUserDelete(ctx, {
          operation: "delete",
          args,
        });
        const ceremonyIds = detachedIds ?? erasedIds;
        if (ceremonyIds !== null && ceremonyIds.length === 0) return;
        return base.delete(
          ceremonyIds === null ? args : pinnedToIds(args, ceremonyIds),
        );
      },
      deleteMany: async (args) => {
        const detachedIds = await detachBeforeAccountDelete(ctx, {
          operation: "deleteMany",
          args,
        });
        const erasedIds = await eraseBeforeUserDelete(ctx, {
          operation: "deleteMany",
          args,
        });
        const ceremonyIds = detachedIds ?? erasedIds;
        if (ceremonyIds !== null && ceremonyIds.length === 0) return 0;
        return base.deleteMany(
          ceremonyIds === null ? args : pinnedToIds(args, ceremonyIds),
        );
      },
      consumeOne: async (args) => {
        routeWrite(args.model, "consumeOne");
        return base.consumeOne(args) as never;
      },
      incrementOne: async (args) => {
        routeWrite(args.model, "incrementOne");
        return base.incrementOne(args) as never;
      },
      transaction: (callback) =>
        base.transaction((trx) => callback(guardTransaction(trx))),
    };
  };
}

async function createRouted(
  ctx: AdapterContext,
  args: Parameters<DbAdapter["create"]>[0],
): Promise<unknown> {
  const route = routeWrite(args.model, "create");
  const isDomainAccount = route === "domain" && args.model === "account";
  const createArgs = isDomainAccount
    ? {
        ...args,
        data: (await attachCeremonyForAccountCreate(
          ctx,
          args.data as Record<string, unknown>,
        )) as never,
        forceAllowId: true,
      }
    : args;
  const created = await ctx.base.create(createArgs);
  if (route === "domain" && args.model === "user") {
    const createdId = (created as { id?: unknown } | null)?.id;
    if (typeof createdId === "string") {
      await mintUserHashKeyAfterCreate(ctx, createdId);
    }
  }
  return created;
}

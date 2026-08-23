/**
 * The identity adapter (ADR-101 §2, R10): better-auth's `database` contract
 * implemented as OUR adapter — a routing facade whose row engine is the
 * stock prismaAdapter. better-auth still never writes the database except
 * through this seam; what the facade adds is the per-(model, operation)
 * ROUTING TABLE (identityRouting.ts) and the per-user write gate:
 *
 *   - Every WRITE is looked up in the routing table. An unrouted write —
 *     a new better-auth model or operation nobody has classified — throws,
 *     loudly, on first use; the coverage test pins the full current surface
 *     so the failure lands in CI before it lands in production.
 *   - `protocol` writes delegate straight to the row engine: byte-identical
 *     to stock behavior, no events (R12 — session rows, token refreshes,
 *     verification bookkeeping).
 *   - `domain` writes run the identity ceremony FIRST for latched users
 *     (guards veto before any row exists — a refused ceremony refuses the
 *     protocol write too), then perform the row write. For unlatched users
 *     the row write happens identically and no events are emitted; the
 *     backfill adopts the rows on its next pass. The gate ships CLOSED for
 *     everyone (identifier-write-gate.ts). The ceremonies live in
 *     accountCeremonies.ts and userCeremonies.ts.
 *   - READS delegate untouched.
 *
 * Writes inside `transaction(...)` are routing-VALIDATED but never emit
 * ceremonies (a ClickHouse append does not belong inside a Postgres
 * transaction); a latched user's transactional domain write logs the gap
 * the backfill will adopt. Today no domain-significant flow is
 * transactional — the guard exists so one appearing is visible
 * (transactionGuard.ts).
 */
import type { BetterAuthOptions } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import type { PrismaClient } from "~/generated/prisma/client";
import { isUserOnIdentityWrites } from "~/server/app-layer/identity/identifier-write-gate";
import { IdentityCeremonies } from "~/server/app-layer/identity/identity-ceremonies";
import { prisma as appPrisma } from "~/server/db";
import {
  attachCeremonyForAccountCreate,
  detachBeforeAccountDelete,
} from "./accountCeremonies";
import {
  type AdapterContext,
  type DbAdapter,
  pinnedToIds,
} from "./identityAdapterContext";
import { routeWrite } from "./identityRouting";
import { guardTransaction } from "./transactionGuard";
import { eraseBeforeUserDelete, mintUserHashKey } from "./userCeremonies";

export interface IdentityDatabaseDeps {
  prisma?: PrismaClient;
  ceremonies?: Pick<
    IdentityCeremonies,
    "attachIdentifier" | "detachIdentifier" | "eraseUser"
  >;
  isLatched?: (params: { userId: string }) => Promise<boolean>;
  now?: () => number;
}

export function createIdentityDatabase(
  deps: IdentityDatabaseDeps = {},
): (options: BetterAuthOptions) => DbAdapter {
  const prisma = deps.prisma ?? appPrisma;
  // Constructed lazily: the ceremonies service resolves the app handle per
  // call, and a bare script that never composes an App must still be able to
  // import this module (the gate answers false there and no ceremony runs).
  let ceremonies = deps.ceremonies;
  const resolveCeremonies = () => {
    ceremonies ??= new IdentityCeremonies({ prisma });
    return ceremonies;
  };

  return (options: BetterAuthOptions): DbAdapter => {
    const base = prismaAdapter(prisma, { provider: "postgresql" })(options);
    const ctx: AdapterContext = {
      base,
      prisma,
      isLatched: deps.isLatched ?? isUserOnIdentityWrites,
      now: deps.now ?? Date.now,
      resolveCeremonies,
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
    if (typeof createdId === "string") await mintUserHashKey(ctx, createdId);
  }
  return created;
}

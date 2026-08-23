/**
 * The identity adapter (ADR-101 §2, R10): better-auth's `database` contract
 * implemented as OUR adapter — a routing facade whose row engine is the
 * stock prismaAdapter. better-auth still never writes the database except
 * through this seam; what the facade adds is the per-(model, operation)
 * ROUTING TABLE and the per-user write gate:
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
 *     the row write happens identically and no events are emitted; the PR 2
 *     backfill adopts the rows on its next pass. The gate ships CLOSED for
 *     everyone (identifier-write-gate.ts).
 *   - READS delegate untouched.
 *
 * Writes inside `transaction(...)` are routing-VALIDATED but never emit
 * ceremonies (a ClickHouse append does not belong inside a Postgres
 * transaction); a latched user's transactional domain write logs the gap
 * the backfill will adopt. Today no domain-significant flow is
 * transactional — the guard exists so one appearing is visible.
 */
import { randomBytes } from "node:crypto";
import { createLogger } from "@langwatch/observability";
import type { BetterAuthOptions } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import type { PrismaClient } from "~/generated/prisma/client";
import { isUserOnIdentityWrites } from "~/server/app-layer/identity/identifier-write-gate";
import {
  IdentityCeremonies,
  newIdentityCommandId,
} from "~/server/app-layer/identity/identity-ceremonies";
import { prisma as appPrisma } from "~/server/db";
import type { IdentifierProvider } from "~/server/event-sourcing/pipelines/identity/schemas/events";

const logger = createLogger("langwatch:better-auth:identity-adapter");

type DbAdapter = ReturnType<ReturnType<typeof prismaAdapter>>;
type TransactionAdapter = Parameters<
  Parameters<DbAdapter["transaction"]>[0]
>[0];

export type WriteOperation =
  | "create"
  | "update"
  | "updateMany"
  | "delete"
  | "deleteMany"
  | "consumeOne"
  | "incrementOne";

const WRITE_OPERATIONS: readonly WriteOperation[] = [
  "create",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "consumeOne",
  "incrementOne",
];

type Route = "protocol" | "domain";

/**
 * The routing table — every better-auth model this deployment mounts, every
 * write operation, explicitly classified. Keys are better-auth's CANONICAL
 * model names (the facade sits above the factory's model/field mapping, so
 * it sees `user`, never `User`).
 *
 * `domain` today means exactly the D01 ceremonies: an account created inside
 * a sign-up/link ceremony is an identifier attach; an account deleted is a
 * detach. `user.create` is domain for the userHashKey mint (ADR-101 §4) —
 * its attach ceremony is unreachable by construction (a brand-new user has
 * no migration row, so the gate answers false) and their email identifier is
 * adopted by the backfill instead.
 */
const ROUTING: Record<string, Record<WriteOperation, Route>> = {
  user: {
    create: "domain",
    update: "protocol",
    updateMany: "protocol",
    delete: "protocol",
    deleteMany: "protocol",
    consumeOne: "protocol",
    incrementOne: "protocol",
  },
  account: {
    create: "domain",
    update: "protocol",
    updateMany: "protocol",
    delete: "domain",
    deleteMany: "domain",
    consumeOne: "protocol",
    incrementOne: "protocol",
  },
  session: {
    create: "protocol",
    update: "protocol",
    updateMany: "protocol",
    delete: "protocol",
    deleteMany: "protocol",
    consumeOne: "protocol",
    incrementOne: "protocol",
  },
  verification: {
    create: "protocol",
    update: "protocol",
    updateMany: "protocol",
    delete: "protocol",
    deleteMany: "protocol",
    consumeOne: "protocol",
    incrementOne: "protocol",
  },
  // better-auth's rate limiter persists here when its storage is "database".
  // This deployment stores rate limits in secondary storage (Redis), so the
  // model is dormant — routed anyway so a configuration change cannot become
  // an unrouted write in the middle of a sign-in burst.
  ratelimit: {
    create: "protocol",
    update: "protocol",
    updateMany: "protocol",
    delete: "protocol",
    deleteMany: "protocol",
    consumeOne: "protocol",
    incrementOne: "protocol",
  },
};

export const ROUTED_MODELS = Object.keys(ROUTING);
export { WRITE_OPERATIONS };

/** An unclassified (model, operation) — deliberately noisy (ADR-101 §2). */
export class IdentityAdapterUnroutedWriteError extends Error {
  constructor(
    readonly model: string,
    readonly operation: WriteOperation,
  ) {
    super(
      `identity adapter: better-auth wrote to an unrouted (model, operation): ("${model}", "${operation}"). ` +
        "Classify it in the routing table (identityDatabase.ts) as protocol or domain.",
    );
    this.name = "IdentityAdapterUnroutedWriteError";
  }
}

export function routeWrite(model: string, operation: WriteOperation): Route {
  const route = ROUTING[model]?.[operation];
  if (!route) throw new IdentityAdapterUnroutedWriteError(model, operation);
  return route;
}

/** better-auth providerIds → the identifier provider vocabulary (D01). */
export function identifierProviderFor(providerId: string): IdentifierProvider {
  switch (providerId) {
    case "credential":
      return "credential";
    case "google":
      return "google";
    case "github":
      return "github";
    case "gitlab":
      return "gitlab";
    case "microsoft":
    case "azure-ad":
      return "azure-ad";
    default:
      // Generic OAuth / enterprise IdPs (auth0, okta, custom OIDC) all
      // arrive through the oidc bucket until D04 gives them connections.
      return "oidc";
  }
}

interface AccountRowShape {
  id: string;
  userId: string;
  providerId: string;
  accountId: string;
}

export interface IdentityDatabaseDeps {
  prisma?: PrismaClient;
  ceremonies?: Pick<
    IdentityCeremonies,
    "attachIdentifier" | "detachIdentifier"
  >;
  isLatched?: (params: { userId: string }) => Promise<boolean>;
  now?: () => number;
}

export function createIdentityDatabase(
  deps: IdentityDatabaseDeps = {},
): (options: BetterAuthOptions) => DbAdapter {
  const prisma = deps.prisma ?? appPrisma;
  const isLatched = deps.isLatched ?? isUserOnIdentityWrites;
  const now = deps.now ?? Date.now;
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

    async function mintUserHashKey(userId: string): Promise<void> {
      try {
        await prisma.user.update({
          where: { id: userId },
          data: { userHashKey: randomBytes(32).toString("hex") },
        });
      } catch (error) {
        // The mint is additive bookkeeping; a sign-up must not fail on it.
        // A user without a key attaches identifiers with null hashes until
        // the backfill (which mints missing keys) reaches them.
        logger.warn(
          { userId, error },
          "could not mint userHashKey at user creation; identifier hashes stay null until the backfill mints it",
        );
      }
    }

    async function attachCeremonyForAccountCreate(
      data: Record<string, unknown>,
    ): Promise<void> {
      const userId = data.userId;
      const providerId = data.providerId;
      const providerAccountId = data.accountId;
      if (typeof userId !== "string" || typeof providerId !== "string") return;
      if (!(await isLatched({ userId }))) return;

      const user = await base.findOne<{ email: string | null }>({
        model: "user",
        where: [{ field: "id", value: userId }],
      });
      const value = user?.email;
      if (!value) {
        logger.warn(
          { userId, providerId },
          "latched user's account ceremony carries no email value; no identifier attached",
        );
        return;
      }
      // Guards veto HERE, before the Account row exists; the events land
      // durably (waited) and fold on the calling path before the row write.
      await resolveCeremonies().attachIdentifier({
        tenantId: userId,
        userId,
        commandId: newIdentityCommandId(),
        accountId: null,
        provider: identifierProviderFor(providerId),
        providerAccountId:
          typeof providerAccountId === "string" ? providerAccountId : null,
        value,
        occurredAtMs: now(),
        ceremony: { flow: "better-auth" },
        actor: { type: "user", id: userId },
      });
    }

    async function detachCeremoniesForAccountRows(
      rows: AccountRowShape[],
    ): Promise<void> {
      for (const row of rows) {
        if (!(await isLatched({ userId: row.userId }))) continue;
        const state = await resolveCeremonies();
        await state.detachIdentifier({
          tenantId: row.userId,
          userId: row.userId,
          commandId: newIdentityCommandId(),
          identifierId: await identifierIdForAccountRow({ prisma, row }),
          occurredAtMs: now(),
          actor: { type: "user", id: row.userId },
        });
      }
    }

    return {
      ...base,

      create: async (args) => {
        const route = routeWrite(args.model, "create");
        if (route === "domain" && args.model === "account") {
          await attachCeremonyForAccountCreate(
            args.data as Record<string, unknown>,
          );
        }
        const created = await base.create(args);
        if (route === "domain" && args.model === "user") {
          const createdId = (created as { id?: unknown } | null)?.id;
          if (typeof createdId === "string") await mintUserHashKey(createdId);
        }
        return created as never;
      },

      update: async (args) => {
        routeWrite(args.model, "update");
        return base.update(args) as never;
      },

      updateMany: async (args) => {
        routeWrite(args.model, "updateMany");
        return base.updateMany(args);
      },

      delete: async (args) => {
        const route = routeWrite(args.model, "delete");
        if (route === "domain" && args.model === "account") {
          const rows = await base.findMany<AccountRowShape>({
            model: "account",
            where: args.where,
          });
          await detachCeremoniesForAccountRows(rows);
        }
        return base.delete(args);
      },

      deleteMany: async (args) => {
        const route = routeWrite(args.model, "deleteMany");
        if (route === "domain" && args.model === "account") {
          const rows = await base.findMany<AccountRowShape>({
            model: "account",
            where: args.where,
          });
          await detachCeremoniesForAccountRows(rows);
        }
        return base.deleteMany(args);
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

/**
 * The identifier a protocol Account row mirrors: resolved from the user's
 * projection by accountId first, then by (provider, providerAccountId)
 * identity — the same key the deterministic id derives from.
 */
async function identifierIdForAccountRow({
  prisma,
  row,
}: {
  prisma: PrismaClient;
  row: AccountRowShape;
}): Promise<string> {
  const byAccount = await prisma.identifier.findFirst({
    where: { userId: row.userId, accountId: row.id },
    select: { id: true },
  });
  if (byAccount) return byAccount.id;
  const byIdentity = await prisma.identifier.findFirst({
    where: {
      userId: row.userId,
      provider: identifierProviderFor(row.providerId),
      detachedAt: null,
    },
    select: { id: true },
  });
  if (byIdentity) return byIdentity.id;
  throw new Error(
    "identity adapter: no Identifier row mirrors the Account row being deleted for this latched user",
  );
}

/**
 * Writes inside a transaction are routing-validated but never emit
 * ceremonies; see the module doc. `latched` users' domain writes in here
 * would be an event gap — logged so the flow that introduces one is seen.
 */
function guardTransaction(trx: TransactionAdapter): TransactionAdapter {
  // `Fn` is constrained on `never` rather than `{ model: string }` because the
  // adapter's write methods are generic over their payload, and a generic
  // function's parameter is not assignable FROM the bare `{ model }` shape.
  const guardedWrite = <Fn extends (args: never) => unknown>(
    operation: WriteOperation,
    run: Fn,
  ): Fn =>
    ((args: { model: string }) => {
      const route = routeWrite(args.model, operation);
      if (route === "domain") {
        logger.warn(
          { model: args.model, operation },
          "domain-significant better-auth write inside a transaction: no ceremony runs here; the backfill adopts the row",
        );
      }
      return run(args as never);
    }) as unknown as Fn;

  return {
    ...trx,
    create: guardedWrite("create", trx.create.bind(trx)),
    update: guardedWrite("update", trx.update.bind(trx)),
    updateMany: guardedWrite("updateMany", trx.updateMany.bind(trx)),
    delete: guardedWrite("delete", trx.delete.bind(trx)),
    deleteMany: guardedWrite("deleteMany", trx.deleteMany.bind(trx)),
    consumeOne: guardedWrite("consumeOne", trx.consumeOne.bind(trx)),
    incrementOne: guardedWrite("incrementOne", trx.incrementOne.bind(trx)),
  };
}

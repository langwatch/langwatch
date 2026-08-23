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
 *     the row write happens identically and no events are emitted; the
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
import { createLogger } from "@langwatch/observability";
import type { BetterAuthOptions } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nanoid } from "nanoid";
import type { PrismaClient } from "~/generated/prisma/client";
import { isUserOnIdentityWrites } from "~/server/app-layer/identity/identifier-write-gate";
import {
  IdentityCeremonies,
  newIdentityCommandId,
} from "~/server/app-layer/identity/identity-ceremonies";
import { mintUserHashKeyIfMissing } from "~/server/app-layer/identity/user-hash-key";
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
 * detach; a user deleted is an erasure (the ceremony that wipes
 * `Identifier.value`/`identifierHash` — a protocol row delete alone would
 * leave them populated). `user.create` is domain for the userHashKey mint (ADR-101 §4) —
 * its attach ceremony is unreachable by construction (a brand-new user has
 * no migration row, so the gate answers false) and their email identifier is
 * adopted by the backfill instead.
 */
const ROUTING: Record<string, Record<WriteOperation, Route>> = {
  user: {
    create: "domain",
    update: "protocol",
    updateMany: "protocol",
    delete: "domain",
    deleteMany: "domain",
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
        await detachBeforeAccountDelete(ctx, { operation: "delete", args });
        await eraseBeforeUserDelete(ctx, { operation: "delete", args });
        return base.delete(args);
      },
      deleteMany: async (args) => {
        await detachBeforeAccountDelete(ctx, { operation: "deleteMany", args });
        await eraseBeforeUserDelete(ctx, { operation: "deleteMany", args });
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

interface AdapterContext {
  base: DbAdapter;
  prisma: PrismaClient;
  isLatched: (params: { userId: string }) => Promise<boolean>;
  now: () => number;
  resolveCeremonies: () => Pick<
    IdentityCeremonies,
    "attachIdentifier" | "detachIdentifier" | "eraseUser"
  >;
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

async function detachBeforeAccountDelete(
  ctx: AdapterContext,
  {
    operation,
    args,
  }: {
    operation: "delete" | "deleteMany";
    args: Parameters<DbAdapter["delete"]>[0];
  },
): Promise<void> {
  const route = routeWrite(args.model, operation);
  if (route !== "domain" || args.model !== "account") return;
  const rows = await ctx.base.findMany<AccountRowShape>({
    model: "account",
    where: args.where,
  });
  await detachCeremoniesForAccountRows(ctx, rows);
}

/**
 * A user delete is domain-significant: erasure is what wipes
 * `Identifier.value` and `identifierHash`, so a bare protocol row delete
 * would leave a deleted user's PII sitting in the projection forever
 * (the backfill finalizes a missing user without cleanup). Latched users
 * run the erase ceremony BEFORE the row delete — a vetoed ceremony refuses
 * the protocol write too. Unlatched users skip; the backfill/erasure
 * service reconciles their rows, exactly as the detach path does.
 */
async function eraseBeforeUserDelete(
  ctx: AdapterContext,
  {
    operation,
    args,
  }: {
    operation: "delete" | "deleteMany";
    args: Parameters<DbAdapter["delete"]>[0];
  },
): Promise<void> {
  const route = routeWrite(args.model, operation);
  if (route !== "domain" || args.model !== "user") return;
  const rows = await ctx.base.findMany<{ id: string }>({
    model: "user",
    where: args.where,
  });
  for (const row of rows) {
    const userId = row.id;
    if (!(await ctx.isLatched({ userId }))) continue;
    await ctx.resolveCeremonies().eraseUser({
      tenantId: userId,
      userId,
      commandId: newIdentityCommandId(),
      occurredAtMs: ctx.now(),
      actor: { type: "user", id: userId },
    });
  }
}

async function mintUserHashKey(
  ctx: AdapterContext,
  userId: string,
): Promise<void> {
  try {
    await mintUserHashKeyIfMissing({ prisma: ctx.prisma, userId });
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

/** The fields an Account create carries that the ceremony needs, or null. */
function accountCreateIntent(
  data: Record<string, unknown>,
  now: () => number,
): {
  userId: string;
  providerId: string;
  providerAccountId: string | null;
  accountId: string;
  occurredAtMs: number;
} | null {
  const { userId, providerId, accountId, id, createdAt } = data;
  if (typeof userId !== "string" || typeof providerId !== "string") {
    return null;
  }
  return {
    userId,
    providerId,
    providerAccountId: typeof accountId === "string" ? accountId : null,
    // Minted the same way the schema's own `@default(nanoid())` would mint
    // it — this id is persisted via `forceAllowId`, so it must match.
    accountId: typeof id === "string" ? id : nanoid(),
    occurredAtMs: createdAt instanceof Date ? createdAt.getTime() : now(),
  };
}

/**
 * The live attach must derive the SAME identifier id the backfill will
 * derive from the row later (ADR-101 §3: backfill and live emission
 * converge). The id derives from `(userId, provider, providerAccountId,
 * value, occurredAt)`, and the backfill takes `occurredAt` from
 * `Account.createdAt` and links the row by `Account.id` — so the ceremony
 * reads `createdAt` off the row better-auth is about to write and mints
 * the row's id up front (the adapter factory honours a caller-set id on
 * `create`), then hands both to the attach. Returns the data the row
 * write must use, id included.
 */
async function attachCeremonyForAccountCreate(
  ctx: AdapterContext,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const intent = accountCreateIntent(data, ctx.now);
  if (!intent) return data;
  const { userId, providerId } = intent;
  if (!(await ctx.isLatched({ userId }))) return data;

  const user = await ctx.base.findOne<{ email: string | null }>({
    model: "user",
    where: [{ field: "id", value: userId }],
  });
  const value = user?.email;
  if (!value) {
    logger.warn(
      { userId, providerId },
      "latched user's account ceremony carries no email value; no identifier attached",
    );
    return data;
  }
  // Guards veto HERE, before the Account row exists; the events land
  // durably (waited) and fold on the calling path before the row write.
  await ctx.resolveCeremonies().attachIdentifier({
    tenantId: userId,
    userId,
    commandId: newIdentityCommandId(),
    accountId: intent.accountId,
    provider: identifierProviderFor(providerId),
    providerAccountId: intent.providerAccountId,
    value,
    occurredAtMs: intent.occurredAtMs,
    ceremony: { flow: "better-auth" },
    actor: { type: "user", id: userId },
  });
  return { ...data, id: intent.accountId };
}

async function detachCeremoniesForAccountRows(
  ctx: AdapterContext,
  rows: AccountRowShape[],
): Promise<void> {
  for (const row of rows) {
    if (!(await ctx.isLatched({ userId: row.userId }))) continue;
    const identifierId = await identifierIdForAccountRow({
      prisma: ctx.prisma,
      row,
    });
    if (identifierId === null) {
      // Nothing in the projection mirrors this row (adopted before the
      // projection carried accountIds, or ambiguous). The protocol
      // delete must still happen; the backfill's next pass detaches
      // whatever the row's absence implies.
      logger.warn(
        { userId: row.userId, accountId: row.id, providerId: row.providerId },
        "no unambiguous Identifier mirrors the Account row being deleted; protocol delete proceeds, the backfill reconciles",
      );
      continue;
    }
    await ctx.resolveCeremonies().detachIdentifier({
      tenantId: row.userId,
      userId: row.userId,
      commandId: newIdentityCommandId(),
      identifierId,
      occurredAtMs: ctx.now(),
      actor: { type: "user", id: row.userId },
    });
  }
}

/**
 * The identifier a protocol Account row mirrors: resolved from the user's
 * projection by accountId first. A row adopted before the projection
 * carried accountIds falls back to the user's live identifiers on the same
 * provider — used only when that names exactly ONE identifier; two or more
 * is ambiguous and answers null rather than a guess; so does no match. The
 * caller logs and lets the protocol delete proceed — the backfill's next
 * pass reconciles the row.
 */
async function identifierIdForAccountRow({
  prisma,
  row,
}: {
  prisma: PrismaClient;
  row: AccountRowShape;
}): Promise<string | null> {
  const byAccount = await prisma.identifier.findFirst({
    where: { userId: row.userId, accountId: row.id },
    select: { id: true },
  });
  if (byAccount) return byAccount.id;
  const byProvider = await prisma.identifier.findMany({
    where: {
      userId: row.userId,
      provider: identifierProviderFor(row.providerId),
      detachedAt: null,
    },
    select: { id: true },
    take: 2,
  });
  return byProvider.length === 1 ? (byProvider[0]?.id ?? null) : null;
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

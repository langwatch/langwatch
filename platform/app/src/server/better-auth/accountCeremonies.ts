import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";
import type { PrismaClient } from "~/generated/prisma/client";
import { newIdentityCommandId } from "~/server/app-layer/identity/identity-ceremonies";
import type { AdapterContext, DbAdapter } from "./identityAdapterContext";
import { identifierProviderFor, routeWrite } from "./identityRouting";

const logger = createLogger("langwatch:better-auth:identity-adapter");

interface AccountRowShape {
  id: string;
  userId: string;
  providerId: string;
  accountId: string;
}

export async function detachBeforeAccountDelete(
  ctx: AdapterContext,
  {
    operation,
    args,
  }: {
    operation: "delete" | "deleteMany";
    args: Parameters<DbAdapter["delete"]>[0];
  },
): Promise<string[] | null> {
  const route = routeWrite(args.model, operation);
  if (route !== "domain" || args.model !== "account") return null;
  const rows = await ctx.base.findMany<AccountRowShape>({
    model: "account",
    where: args.where,
  });
  await detachCeremoniesForAccountRows(ctx, rows);
  return rows.map((row) => row.id);
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
export async function attachCeremonyForAccountCreate(
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

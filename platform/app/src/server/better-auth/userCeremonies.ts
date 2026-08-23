import { createLogger } from "@langwatch/observability";
import { newIdentityCommandId } from "~/server/app-layer/identity/identity-ceremonies";
import { mintUserHashKeyIfMissing } from "~/server/app-layer/identity/user-hash-key";
import type { AdapterContext, DbAdapter } from "./identityAdapterContext";
import { routeWrite } from "./identityRouting";

const logger = createLogger("langwatch:better-auth:identity-adapter");

/**
 * A user delete is domain-significant: erasure is what wipes
 * `Identifier.value` and `identifierHash`, so a bare protocol row delete
 * would leave a deleted user's PII sitting in the projection forever
 * (the backfill finalizes a missing user without cleanup). Latched users
 * run the erase ceremony BEFORE the row delete — a vetoed ceremony refuses
 * the protocol write too. Unlatched users skip; the backfill/erasure
 * service reconciles their rows, exactly as the detach path does.
 */
export async function eraseBeforeUserDelete(
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
  if (route !== "domain" || args.model !== "user") return null;
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
  return rows.map((row) => row.id);
}

export async function mintUserHashKey(
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

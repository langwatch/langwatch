import { generate } from "@langwatch/ksuid";

/**
 * Identity command identity — the analogue of the grants ledger's
 * `deriveGrantId` (`packages/authz-server/src/ledger/grant-identity.ts`,
 * ADR-092 §13). Every form a command id takes lives here, so the string
 * that decides whether a retry is the same command is never a template
 * literal three modules apart from the one it has to agree with.
 *
 * Two families, and the difference between them is the whole point:
 *
 *  - A LIVE ceremony mints a random id. Two sign-ins are two commands, and
 *    a retry of one ceremony reuses the id it already minted.
 *  - An ADOPTION derives its id from the SOURCE ROW. Every backfill pass
 *    over an unchanged user therefore states the same command id, and the
 *    store's read-side dedupe absorbs the restatement (ADR-101 §6, #7429).
 *
 * These strings are a persisted contract: changing one makes every prior
 * command a different command, so a pass would restate history that is
 * already in the log. Add a form; never edit one.
 */

/** A live ceremony's command id — random, minted once per ceremony. */
export function newIdentityCommandId(): string {
  return generate("idcmd").toString();
}

/** Adopting the identifier an `Account` row implies. */
export function adoptAccountCommandId({ accountId }: { accountId: string }): string {
  return `backfill:${accountId}`;
}

/** Adopting the identifier `User.email` implies. */
export function adoptUserEmailCommandId({ userId }: { userId: string }): string {
  return `backfill:user-email:${userId}`;
}

/** Establishing that email as verified, because `User.emailVerified` says so. */
export function establishUserEmailCommandId({ userId }: { userId: string }): string {
  return `backfill:verify-email:${userId}`;
}

/**
 * The compensating detach (ADR-101 §6): an identifier adopted from an
 * `Account` row that has since gone. Keyed on both ids so it stays stable
 * across passes — the same orphan detaches once, however many passes see it.
 */
export function detachOrphanCommandId({
  identifierId,
  accountId,
}: {
  identifierId: string;
  accountId: string;
}): string {
  return `backfill:detach:${identifierId}:${accountId}`;
}

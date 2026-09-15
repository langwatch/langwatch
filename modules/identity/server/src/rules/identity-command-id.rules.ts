import { generate } from "@langwatch/ksuid";

/**
 * Identity command identity — the analogue of the grants ledger's
 * `deriveGrantId` (ADR-092 §13). A LIVE ceremony mints a random id per
 * ceremony; an ADOPTION derives its id from the source row, so a repeated
 * backfill restates the same id and read-side dedupe absorbs it. A persisted
 * contract — add a form, never edit one.
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

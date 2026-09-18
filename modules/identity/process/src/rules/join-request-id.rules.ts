import { generate } from "@langwatch/ksuid";

/**
 * Join-request identity (D12): every id/command-id form lives here, never
 * duplicated. A persisted contract — changing a form makes every prior
 * command a different command. Add a form; never edit one.
 */

/** A request somebody made — random, minted once. */
export function newJoinRequestId(): string {
  return generate("jreq").toString();
}

/** A live action's command id: an admin's click, a withdrawal, an ask. */
export function newJoinRequestCommandId(): string {
  return generate("jreqcmd").toString();
}

/**
 * The command id an EXPIRY wake dispatches with, derived from the request
 * and deadline so a redelivered wake derives a byte-identical idempotency
 * key and the event store dedupes it.
 */
export function expireJoinCommandId({
  joinRequestId,
  scheduledFor,
}: {
  joinRequestId: string;
  scheduledFor: number;
}): string {
  return `join-expire:${joinRequestId}:${scheduledFor}`;
}

/**
 * The command id an APPROVAL dispatches with, derived from request and
 * resolver, not minted fresh — a retry after a partial failure must be the
 * same command so a replay attaches membership exactly once.
 */
export function approveJoinCommandId({
  joinRequestId,
  resolvedByType,
  resolvedById,
}: {
  joinRequestId: string;
  resolvedByType: string;
  resolvedById: string;
}): string {
  return `join-approve:${joinRequestId}:${resolvedByType}:${resolvedById}`;
}

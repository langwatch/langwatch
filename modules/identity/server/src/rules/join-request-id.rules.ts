import { generate } from "@langwatch/ksuid";

/**
 * Join-request identity (D12): every form a join-request id or command id
 * takes lives here, so the string deciding whether a retry is the same
 * command is never duplicated elsewhere. A persisted contract — changing a
 * form makes every prior command a different command. Add a form; never edit one.
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
 * The command id an EXPIRY wake dispatches with.
 *
 * Derived from the request and the deadline it was scheduled for, so a wake
 * redelivered by a lagged worker derives byte-identical idempotency keys and
 * the event store dedupes it. A wake that fires twice must cost one event.
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
 * The command id an APPROVAL dispatches with, derived from the request and
 * resolver rather than minted fresh: a retry after a partial failure (fact
 * landed, membership didn't) must be the same command, so a replayed
 * approval attaches membership exactly once.
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

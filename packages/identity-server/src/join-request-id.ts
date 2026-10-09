import { generate } from "@langwatch/ksuid";

/**
 * Join-request identity (D12) — the analogue of `sso-connection-id.ts` one
 * aggregate over. Every form a join-request id or a join-request command id
 * takes lives here, so the string that decides whether a retry is the same
 * command is never a template literal three modules apart from the one it has
 * to agree with.
 *
 * These strings are a persisted contract: changing one makes every prior
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
 * The command id an EXPIRY wake dispatches with.
 *
 * Derived from the request and the deadline it was scheduled for, so a wake
 * redelivered by a lagged worker derives byte-identical idempotency keys and
 * the event store dedupes it. A wake that fires twice must cost one event.
 */
function expireJoinCommandId({
  joinRequestId,
  scheduledFor,
}: {
  joinRequestId: string;
  scheduledFor: number;
}): string {
  return `join-expire:${joinRequestId}:${scheduledFor}`;
}

/**
 * The command id an APPROVAL dispatches with.
 *
 * Derived from the request and who resolved it rather than minted fresh: an
 * approval retried after a partial failure — the fact landed, the membership
 * did not — has to be the same command, or the retry would state a second
 * approval on a request that already has one. This is what makes "a replayed
 * approval attaches membership exactly once" a property of the pipeline.
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

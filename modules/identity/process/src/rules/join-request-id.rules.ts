import { generate } from "@langwatch/ksuid";

export const JOIN_REQUEST_LIFECYCLE_PROCESS_NAME = "joinRequestLifecycle" as const;

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

/**
 * One recipient's delivery of one notice, as main keys it
 * (`process:tenant:message:recipient`): a retried send is the same mail, and the
 * recipient is named by user id.
 */
export function joinNotificationDeliveryKey({
  organizationId,
  joinRequestId,
  kind,
  recipientUserId,
}: {
  organizationId: string;
  joinRequestId: string;
  kind: string;
  recipientUserId: string;
}): string {
  return `${JOIN_REQUEST_LIFECYCLE_PROCESS_NAME}:${organizationId}:join:${joinRequestId}:${kind}:${recipientUserId}`;
}

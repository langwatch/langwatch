/**
 * Redis key family of local control (ADR-129), built here so no module
 * hand-copies a format. `v1` is the shape version — an incompatible layout
 * takes `v2` and the two never read each other's keys.
 */

const PREFIX = "langy_local:v1";

/** The folder connected to one conversation: instance, workspace, last seen. */
export function presenceKey(conversationId: string): string {
  return `${PREFIX}:presence:${conversationId}`;
}

/**
 * Whether the developer turned the permission cards off for one conversation.
 * The choice belongs to the share that carried it: ending the share clears
 * this key too, so a new command line starts with the cards back on.
 */
export function policyKey(conversationId: string): string {
  return `${PREFIX}:policy:${conversationId}`;
}

/**
 * The connect turn one folder is owed, started when the in-flight turn's end is folded. Cleared by
 * the first call a turn places on the folder, by the owed turn's start, and with the share.
 */
export function owedConnectTurnKey(conversationId: string): string {
  return `${PREFIX}:connect-owed:${conversationId}`;
}

/** One control request, from the card that asked to the approval that spends it. */
export function controlRequestKey(requestId: string): string {
  return `${PREFIX}:request:${requestId}`;
}

/**
 * Set once a request is spent. A request is single use, and two terminals
 * racing each other contend for this one key, so exactly one of them wins.
 */
export function controlRequestClaimKey(requestId: string): string {
  return `${PREFIX}:request_claim:${requestId}`;
}

/**
 * ZSET of a user's open request ids across every project, scored by expiry. The answering login may
 * be on another project, so the project is never part of the key.
 */
export function userRequestsKey(userId: string): string {
  return `${PREFIX}:requests:${userId}`;
}

/**
 * What one minted session key is allowed to control. A Langy session key is
 * project-scoped by itself, so this binding is what makes the command line's
 * key answer for exactly one conversation and refuse every other.
 */
export function sessionKeyBindingKey(apiKeyId: string): string {
  return `${PREFIX}:key_binding:${apiKeyId}`;
}

/**
 * ZSET of minted keys controlling one conversation, scored by binding lapse.
 * Needed because the disconnect panel knows only a conversation id, not the
 * key id, so this index is what lets it revoke the credential too.
 */
export function conversationKeyBindingsKey(conversationId: string): string {
  return `${PREFIX}:conversation_keys:${conversationId}`;
}

/** The envelope of one local tool call, with the state it is in. */
export function callKey(callId: string): string {
  return `${PREFIX}:call:${callId}`;
}

/** The answer to one call, written by the pod that holds the socket. */
export function callResultKey(callId: string): string {
  return `${PREFIX}:call_result:${callId}`;
}

/**
 * Held while one call's activity line is fresh. The key is set once per
 * keepalive window and lives exactly that long, so two replicas polling the
 * same call write one line between them instead of one each.
 */
export function callKeepaliveKey(callId: string): string {
  return `${PREFIX}:call_keepalive:${callId}`;
}

/** ZSET of the calls pending on one conversation, scored by deadline. */
export function pendingCallsKey(conversationId: string): string {
  return `${PREFIX}:pending:${conversationId}`;
}

/** One user wait: the permission card or the question card, and its answer. */
export function waitKey(waitId: string): string {
  return `${PREFIX}:wait:${waitId}`;
}

/** ZSET of the waits pending on one turn, scored by their expiry. */
export function turnWaitsKey(conversationId: string, turnId: string): string {
  return `${PREFIX}:turn_waits:${conversationId}:${turnId}`;
}

/** Channel the pod holding a conversation's socket listens on. */
export function workspaceChannel(conversationId: string): string {
  return `${PREFIX}:workspace:${conversationId}`;
}

/** The record one confirmation is about: a click covers exactly this, and nothing near it. */
export interface ConfirmTarget {
  projectId: string;
  conversationId: string;
  resource: string;
  action: string;
  id: string;
}

/**
 * The braces are a Redis hash tag: every key of one conversation lands on one slot, so a bulk
 * request can spend all its clicks in one script, or none, on a cluster too.
 */
function confirmTargetPath({ projectId, conversationId, resource, action, id }: ConfirmTarget) {
  return `{${projectId}:${conversationId}}:${resource}:${action}:${id}`;
}

/**
 * The conversation one Langy key works for. A delete it asks for shows its card there, and only
 * a click there covers it.
 */
export function confirmKeyBindingKey(apiKeyId: string): string {
  return `${PREFIX}:confirm_key:${apiKeyId}`;
}

/** One unspent Yes click: present means the next matching request may run, once. */
export function confirmGrantKey(target: ConfirmTarget): string {
  return `${PREFIX}:confirm_grant:${confirmTargetPath(target)}`;
}

/** The card already asking about one record, so a retry raises no second card. */
export function confirmCardKey(target: ConfirmTarget): string {
  return `${PREFIX}:confirm_card:${confirmTargetPath(target)}`;
}

/** Set by a card's first answer, so the click and its message fallback grant once between them. */
export function confirmClaimKey(waitId: string): string {
  return `${PREFIX}:confirm_claim:${waitId}`;
}

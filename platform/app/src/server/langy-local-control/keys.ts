/**
 * The Redis key family of local control (ADR-129).
 *
 * Every key and channel is built here so no module hand-copies a format. The
 * `v1` segment is the shape version: a later incompatible layout takes `v2`
 * and the two never read each other's keys. Every key that belongs to one
 * conversation carries the conversation id, so a folder shared with one chat
 * can never be read by another.
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

/** ZSET of a user's open request ids in one project, scored by creation time. */
export function userRequestsKey(projectId: string, userId: string): string {
  return `${PREFIX}:requests:${projectId}:${userId}`;
}

/**
 * What one minted session key is allowed to control. A Langy session key is
 * project-scoped by itself, so this binding is what makes the command line's
 * key answer for exactly one conversation and refuse every other.
 */
export function sessionKeyBindingKey(apiKeyId: string): string {
  return `${PREFIX}:key_binding:${apiKeyId}`;
}

/** The envelope of one local tool call, with the state it is in. */
export function callKey(callId: string): string {
  return `${PREFIX}:call:${callId}`;
}

/** The answer to one call, written by the pod that holds the socket. */
export function callResultKey(callId: string): string {
  return `${PREFIX}:call_result:${callId}`;
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

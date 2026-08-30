/**
 * The Redis key family of connected agents (ADR-128).
 *
 * Every key and channel is built here so no module hand-copies a format. The
 * `v1` segment is the shape version: a later incompatible layout takes `v2`
 * and the two never read each other's keys.
 */

const PREFIX = "v1";

/** ZSET of live instance ids of one agent, scored by last seen. */
export function instanceSetKey(projectId: string, agentId: string): string {
  return `agent_instance:${PREFIX}:${projectId}:${agentId}`;
}

/** Hash describing one instance: hostname, pid, sdk, label, pod, and so on. */
export function instanceMetaKey(instanceId: string): string {
  return `agent_instance_meta:${PREFIX}:${instanceId}`;
}

/** Counter of the calls in flight on one instance. */
export function inflightKey(instanceId: string): string {
  return `agent_inflight:${PREFIX}:${instanceId}`;
}

/** The durable envelope of one call. */
export function callKey(callId: string): string {
  return `agent_call:${PREFIX}:${callId}`;
}

/** Set once the instance started the function of one call. */
export function callAckKey(callId: string): string {
  return `agent_call_ack:${PREFIX}:${callId}`;
}

/** ZSET of the call ids pending on one instance, scored by deadline. */
export function pendingKey(instanceId: string): string {
  return `agent_pending:${PREFIX}:${instanceId}`;
}

/** The result of one call, written by the pod that holds the socket. */
export function resultKey(callId: string): string {
  return `agent_result:${PREFIX}:${callId}`;
}

/** Set once a call was handed to its instance over HTTP; it is never handed twice. */
export function callDeliveredKey(callId: string): string {
  return `agent_call_delivered:${PREFIX}:${callId}`;
}

/** The HTTP long-poll session behind one instance token. */
export function httpSessionKey(token: string): string {
  return `agent_http_session:${PREFIX}:${token}`;
}

/** The instance a sticky thread is pinned to. */
export function threadPinKey(agentId: string, threadId: string): string {
  return `agent_thread:${PREFIX}:${agentId}:${threadId}`;
}

/** Channel nudged when a call or a cancel is written for one instance. */
export function instanceChannel(instanceId: string): string {
  return `agent_call:${PREFIX}:${instanceId}`;
}

/** Channel nudged when an ack or a result lands for a pod's calls. */
export function replyChannel(podId: string): string {
  return `agent_reply:${PREFIX}:${podId}`;
}

/** Channel every pod listens on for instances that went away. */
export const INSTANCE_GONE_CHANNEL = `agent_instance_gone:${PREFIX}`;

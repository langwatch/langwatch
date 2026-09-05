/**
 * The Redis key family of connected agents (ADR-128).
 */

const PREFIX = "v1";

/** ZSET of live instance ids of one agent, scored by last seen. */
export function instanceSetKey(projectId: string, agentId: string): string {
  return `agent_instance:${PREFIX}:${projectId}:${agentId}`;
}

/** Hash describing one instance: hostname, pid, sdk, label, pod, and so on. */
export function instanceMetaKey(projectId: string, instanceId: string): string {
  return `agent_instance_meta:${PREFIX}:${projectId}:${instanceId}`;
}

/** Counter of the calls in flight on one instance. */
export function inflightKey(projectId: string, instanceId: string): string {
  return `agent_inflight:${PREFIX}:${projectId}:${instanceId}`;
}

/** The durable envelope of one call. */
export function callKey(projectId: string, callId: string): string {
  return `agent_call:${PREFIX}:${projectId}:${callId}`;
}

/** Set once the instance started the function of one call. */
export function callAckKey(projectId: string, callId: string): string {
  return `agent_call_ack:${PREFIX}:${projectId}:${callId}`;
}

/** ZSET of the call ids pending on one instance, scored by deadline. */
export function pendingKey(projectId: string, instanceId: string): string {
  return `agent_pending:${PREFIX}:${projectId}:${instanceId}`;
}

/** The result of one call, written by the pod that holds the socket. */
export function resultKey(projectId: string, callId: string): string {
  return `agent_result:${PREFIX}:${projectId}:${callId}`;
}

/** Set once a call was handed to its instance over HTTP; it is never handed twice. */
export function callDeliveredKey(projectId: string, callId: string): string {
  return `agent_call_delivered:${PREFIX}:${projectId}:${callId}`;
}

/** The HTTP long-poll session behind one instance token. */
export function httpSessionKey(projectId: string, token: string): string {
  return `agent_http_session:${PREFIX}:${projectId}:${token}`;
}

/** The instance a sticky thread is pinned to. */
export function threadPinKey(projectId: string, agentId: string, threadId: string): string {
  return `agent_thread:${PREFIX}:${projectId}:${agentId}:${threadId}`;
}

/** Channel nudged when a call or a cancel is written for one instance. */
export function instanceChannel(projectId: string, instanceId: string): string {
  return `agent_instance_calls:${PREFIX}:${projectId}:${instanceId}`;
}

/** Channel nudged when an ack or a result lands for a pod's calls. */
export function replyChannel(podId: string): string {
  return `agent_reply:${PREFIX}:${podId}`;
}

/** Channel every pod listens on for instances that went away. */
export const INSTANCE_GONE_CHANNEL = `agent_instance_gone:${PREFIX}`;

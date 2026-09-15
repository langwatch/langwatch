import {
  AgentBusyError,
  AgentInstanceLostError,
  BUSY_RETRY_AFTER_MS,
} from "@langwatch/agent-contract";
import type { LiveInstance } from "../services/connected-agent-runtime.service.ts";

/** The instance a sticky thread is pinned to, while it is still live. */
export function pinnedInstance(live: LiveInstance[], pinned: string): LiveInstance {
  const target = live.find((instance) => instance.instanceId === pinned);
  if (!target) throw new AgentInstanceLostError({ instanceId: pinned });
  return target;
}

/** The instance that takes the thread, or the refusal when all are busy. */
export function chooseInstance(live: LiveInstance[], threadId: string): LiveInstance {
  const free = live
    .map((instance) => ({
      instance,
      slots: instance.maxConcurrency - instance.inflight,
    }))
    .filter(({ slots }) => slots > 0);
  if (free.length === 0) {
    throw new AgentBusyError({ retryAfterMs: BUSY_RETRY_AFTER_MS });
  }
  return pickMostFree(free, threadId).instance;
}

/**
 * The instance with the most free slots; ties go to the rendezvous hash of
 * the thread, so a stateless agent still tends to see one thread from one
 * instance.
 */
function pickMostFree(
  free: { instance: LiveInstance; slots: number }[],
  threadId: string,
): { instance: LiveInstance; slots: number } {
  const best = Math.max(...free.map(({ slots }) => slots));
  const candidates = free.filter(({ slots }) => slots === best);
  if (candidates.length === 1) return candidates[0]!;
  return candidates
    .map((candidate) => ({
      candidate,
      weight: rendezvousWeight(threadId, candidate.instance.instanceId),
    }))
    .sort((left, right) => right.weight - left.weight)[0]!.candidate;
}

/** A stable weight per (thread, instance) pair: FNV-1a over both ids. */
function rendezvousWeight(threadId: string, instanceId: string): number {
  let hash = 0x811c9dc5;
  for (const char of `${threadId}#${instanceId}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

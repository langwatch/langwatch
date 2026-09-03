/**
 * The per-process composition of connected agents: one pod id, one state
 * store, one registry and one dispatcher (ADR-128).
 *
 * The store is Redis when the process installed a connection and process
 * memory otherwise. Redis is INSTALLED by the composition root (ADR-093)
 * rather than read off a module singleton here, and the runtime is built
 * lazily, so a process that never dispatches a call never subscribes.
 *
 * A process that installs no connection still works and is correct only with
 * one replica: the memory store is not shared, so two replicas would each
 * believe they hold every instance.
 */

import { nanoid } from "nanoid";
import type { RedisConnection } from "@langwatch/redis-client";

import {
  type AgentStateStore,
  createMemoryStateStore,
  createRedisStateStore,
} from "../adapters/connected-agent-state.adapter";
import { CallDispatcher } from "../adapters/connected-agent-dispatch.adapter";
import { InstanceRegistry } from "../adapters/connected-agent-registry.adapter";

export interface ConnectedAgentRuntime {
  podId: string;
  store: AgentStateStore;
  registry: InstanceRegistry;
  dispatcher: CallDispatcher;
}

/** Builds a runtime around one store; tests build two to play two pods. */
export function createConnectedAgentRuntime({
  podId = `pod_${nanoid(10)}`,
  store,
  firstTurnGraceMs,
  firstTurnPollMs,
  resultPollMs,
}: {
  podId?: string;
  store: AgentStateStore;
  firstTurnGraceMs?: number;
  firstTurnPollMs?: number;
  resultPollMs?: number;
}): ConnectedAgentRuntime {
  const registry = new InstanceRegistry(store);
  const dispatcher = new CallDispatcher({
    podId,
    store,
    registry,
    firstTurnGraceMs,
    firstTurnPollMs,
    resultPollMs,
  });
  return { podId, store, registry, dispatcher };
}

let processRedis: RedisConnection | null = null;
let processRuntime: ConnectedAgentRuntime | null = null;

/**
 * Hands this process's Redis connection to the runtime it will build.
 *
 * Called once by the composition root, before anything dispatches. Installing
 * after the runtime was built is refused rather than ignored: the runtime
 * already holds a memory store, and a second store would leave two halves of
 * the process disagreeing about who is connected.
 */
export function installConnectedAgentRedis(redis: RedisConnection): void {
  if (processRuntime) {
    throw new Error(
      "The connected agent runtime is already built; install Redis before anything dispatches.",
    );
  }
  processRedis = redis;
}

/** The runtime of this process, built on first use. */
export function getConnectedAgentRuntime(): ConnectedAgentRuntime {
  if (processRuntime) return processRuntime;
  processRuntime = createConnectedAgentRuntime({
    store: processRedis ? createRedisStateStore(processRedis) : createMemoryStateStore(),
  });
  return processRuntime;
}

/** Closes the process runtime; the next read builds a fresh one. */
export async function closeConnectedAgentRuntime(): Promise<void> {
  const runtime = processRuntime;
  processRuntime = null;
  if (!runtime) return;
  await runtime.dispatcher.close();
  await runtime.store.close();
}

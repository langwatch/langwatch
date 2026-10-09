/**
 * The per-process composition of connected agents: one pod id, one state
 * store, one registry and one dispatcher.
 *
 * The store is Redis when the App has one and process memory otherwise. Redis
 * is read off the App (ADR-093), never from a module singleton, and the
 * composition is lazy so a process that never dispatches a call never
 * subscribes.
 */

import { nanoid } from "nanoid";
import { tryGetApp } from "~/server/app-layer/app";
import { CallDispatcher } from "./call.dispatcher";
import { InstanceRegistry } from "./instance.registry";
import {
  type AgentStateStore,
  createMemoryStateStore,
  createRedisStateStore,
} from "./state-store";

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

let processRuntime: ConnectedAgentRuntime | null = null;

/** The runtime of this process, built on first use. */
export function getConnectedAgentRuntime(): ConnectedAgentRuntime {
  if (processRuntime) return processRuntime;
  const redis = tryGetApp()?.redis ?? null;
  processRuntime = createConnectedAgentRuntime({
    store: redis ? createRedisStateStore(redis) : createMemoryStateStore(),
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

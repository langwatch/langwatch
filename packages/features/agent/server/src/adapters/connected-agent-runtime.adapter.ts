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

import type { AgentStateStorePort } from "../ports/agent-state-store.port";
import type { ConnectedAgentRuntime } from "../ports/connected-agent-runtime.port";
import { ConnectedAgentStateAdapter } from "./connected-agent-state.adapter";
import { CallDispatcherAdapter } from "./connected-agent-dispatch.adapter";
import { ConnectedAgentRegistryAdapter } from "./connected-agent-registry.adapter";

let processRedis: RedisConnection | null = null;
let processRuntime: ConnectedAgentRuntime | null = null;

export class ConnectedAgentRuntimeAdapter {
  /** Builds a runtime around one store; tests build two to play two pods. */
  static create({
    podId = `pod_${nanoid(10)}`,
    store,
    firstTurnGraceMs,
    firstTurnPollMs,
    resultPollMs,
  }: {
    podId?: string;
    store: AgentStateStorePort;
    firstTurnGraceMs?: number;
    firstTurnPollMs?: number;
    resultPollMs?: number;
  }): ConnectedAgentRuntime {
    const registry = ConnectedAgentRegistryAdapter.create(store);
    const dispatcher = CallDispatcherAdapter.create({
      podId,
      store,
      registry,
      firstTurnGraceMs,
      firstTurnPollMs,
      resultPollMs,
    });

    return { podId, store, registry, dispatcher };
  }

  /**
   * Hands this process's Redis connection to the runtime it will build.
   *
   * Called once by the composition root, before anything dispatches.
   * Installing after the runtime was built is refused rather than ignored:
   * the runtime already holds a memory store, and a second store would leave
   * two halves of the process disagreeing about who is connected.
   */
  static install(redis: RedisConnection): void {
    if (processRuntime) {
      throw new Error(
        "The connected agent runtime is already built; install Redis before anything dispatches.",
      );
    }

    processRedis = redis;
  }

  /** The runtime of this process, built on first use. */
  static get(): ConnectedAgentRuntime {
    if (processRuntime) {
      return processRuntime;
    }

    processRuntime = ConnectedAgentRuntimeAdapter.create({
      store: ConnectedAgentStateAdapter.create({ redis: processRedis }),
    });

    return processRuntime;
  }

  /** Closes the process runtime; the next read builds a fresh one. */
  static async close(): Promise<void> {
    const runtime = processRuntime;
    processRuntime = null;
    if (!runtime) {
      return;
    }

    await runtime.dispatcher.close();
    await runtime.store.close();
  }

  private constructor() {}
}

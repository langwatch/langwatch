/**
 * The per-process composition of connected agents: one pod id, one state
 * store, one registry and one dispatcher (ADR-128). Redis is installed
 * by the composition root (ADR-093) rather than a module singleton.
 */

import { nanoid } from "nanoid";

import type { SessionStateStore } from "@langwatch/redis-client/session-state";
import { ConnectedAgentDispatchService } from "./connected-agent-dispatch.service.ts";
import { ConnectedAgentRegistryService } from "./connected-agent-registry.service.ts";
import { ConnectedAgentInstanceOwnershipService } from "./connected-agent-instance-ownership.service.ts";

import type { AgentCallSignal, DispatchAgent, DispatchCall } from "@langwatch/agent-contract";

export interface InstanceMeta {
  instanceId: string;
  projectId: string;
  hostname: string;
  username: string;
  pid: number;
  sdk: { name: string; version: string; language: string };
  label: string | null;
  /** The app replica that holds the socket. */
  podId: string;
  connectedAt: number;
  maxConcurrency: number;
}

/** A live instance with the calls it has in flight. */
export interface LiveInstance extends InstanceMeta {
  inflight: number;
  lastSeenAt: number;
}

export interface DispatchParams {
  projectId: string;
  agent: DispatchAgent;
  call: DispatchCall;
  /** Aborted when the relay request goes away; the call is cancelled. */
  signal?: AgentCallSignal;
  now?: () => number;
}

export interface ConnectedAgentRuntime {
  podId: string;
  store: SessionStateStore;
  registry: ConnectedAgentRegistryService;
  dispatcher: ConnectedAgentDispatchService;
  ownership: ConnectedAgentInstanceOwnershipService;
}

export class ConnectedAgentRuntimeService {
  /** Builds a runtime around one store; tests build two to play two pods. */
  static create({
    podId = `pod_${nanoid(10)}`,
    store,
    firstTurnGraceMs,
    firstTurnPollMs,
    resultPollMs,
  }: {
    podId?: string;
    store: SessionStateStore;
    firstTurnGraceMs?: number;
    firstTurnPollMs?: number;
    resultPollMs?: number;
  }): ConnectedAgentRuntime {
    const registry = ConnectedAgentRegistryService.create(store);
    const dispatcher = ConnectedAgentDispatchService.create({
      podId,
      store,
      registry,
      firstTurnGraceMs,
      firstTurnPollMs,
      resultPollMs,
    });

    const ownership = ConnectedAgentInstanceOwnershipService.create(store);
    return { podId, store, registry, dispatcher, ownership };
  }

  private constructor() {}
}

/**
 * The connected-agent runtime as everything above the infrastructure sees it dispatcher.
 * (ADR-128): one pod id, one state store, one presence registry and one call
 */

import type { CallOutcome, DispatchAgent, DispatchCall } from "@langwatch/agent-contract";

import type { AgentStateStorePort } from "./agent-state-store.port";

/** What one instance says about itself, as the agents page shows it. */
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
  signal?: AbortSignal;
  now?: () => number;
}

/** Presence of connected agent instances, and the calls each has in flight. */
export abstract class ConnectedAgentRegistryPort {
  abstract register(params: {
    meta: InstanceMeta;
    agentIds: string[];
    now?: number;
  }): Promise<void>;
  abstract refresh(params: {
    projectId: string;
    instanceId: string;
    agentIds: string[];
    now?: number;
    meta?: InstanceMeta;
  }): Promise<void>;
  abstract deregister(params: {
    projectId: string;
    instanceId: string;
    agentIds: string[];
    now?: number;
  }): Promise<void>;
  abstract listLive(params: {
    projectId: string;
    agentId: string;
    now?: number;
  }): Promise<LiveInstance[]>;
  abstract isLive(params: {
    projectId: string;
    agentId: string;
    instanceId: string;
    now?: number;
  }): Promise<boolean>;
  abstract agentIdsOf(params: { projectId: string; instanceId: string }): Promise<string[]>;
  abstract incrementInflight(params: { projectId: string; instanceId: string }): Promise<number>;
  abstract decrementInflight(params: { projectId: string; instanceId: string }): Promise<number>;
}

/** Sends one turn to one live instance and waits for its answer. */
export abstract class ConnectedAgentDispatchPort {
  abstract start(): Promise<void>;
  abstract close(): Promise<void>;
  abstract dispatch(params: DispatchParams): Promise<CallOutcome>;
}

/** The three pieces a process composes once, and the pod id they share. */
export interface ConnectedAgentRuntime {
  podId: string;
  store: AgentStateStorePort;
  registry: ConnectedAgentRegistryPort;
  dispatcher: ConnectedAgentDispatchPort;
}

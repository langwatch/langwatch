/**
 * The per-process composition of connected agents: one pod id, one state
 * repository, one relay channel, one registry and one dispatcher (ADR-128).
 */

import type { AgentCallSignal, DispatchAgent, DispatchCall } from "@langwatch/agent-contract";
import { generate } from "@langwatch/ksuid";

import type { ConnectedAgentRelayChannel } from "../channels/connected-agent-relay.channel.ts";
import type {
  ConnectedAgentStateRepository,
  InstanceMeta,
} from "../repositories/connected-agent-state.repository.ts";
import { ConnectedAgentDispatchService } from "./connected-agent-dispatch.service.ts";
import { ConnectedAgentInstanceOwnershipService } from "./connected-agent-instance-ownership.service.ts";
import { ConnectedAgentRegistryService } from "./connected-agent-registry.service.ts";

/**
 * The app's KSUID resource for a pod id (`KSUID_RESOURCES.POD`). The literal
 * rather than the app's constant table: the prefix is part of the id format
 * already carried by every running instance, so it belongs with the writer.
 */
const POD_KSUID_RESOURCE = "pod";

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
  state: ConnectedAgentStateRepository;
  relay: ConnectedAgentRelayChannel;
  registry: ConnectedAgentRegistryService;
  dispatcher: ConnectedAgentDispatchService;
  ownership: ConnectedAgentInstanceOwnershipService;
}

export class ConnectedAgentRuntimeService {
  /** Builds a runtime around one state and one relay; tests build two to play two pods. */
  static create({
    podId = generate(POD_KSUID_RESOURCE).toString(),
    state,
    relay,
    firstTurnGraceMs,
    firstTurnPollMs,
    resultPollMs,
  }: {
    podId?: string;
    state: ConnectedAgentStateRepository;
    relay: ConnectedAgentRelayChannel;
    firstTurnGraceMs?: number;
    firstTurnPollMs?: number;
    resultPollMs?: number;
  }): ConnectedAgentRuntime {
    const registry = ConnectedAgentRegistryService.create(state);
    const dispatcher = ConnectedAgentDispatchService.create({
      podId,
      state,
      relay,
      registry,
      firstTurnGraceMs,
      firstTurnPollMs,
      resultPollMs,
    });

    const ownership = ConnectedAgentInstanceOwnershipService.create(state);
    return { podId, state, relay, registry, dispatcher, ownership };
  }

  private constructor() {}
}

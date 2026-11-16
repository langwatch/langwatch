// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { AgentStopStatus } from "@langwatch/enterprise-governance-contract";
import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";

import type { AgentStopProjectionState } from "../features/kill-switch/eventing/agent-stop.projection.ts";
import type { AgentStopRecord } from "../features/kill-switch/rules/agent-stop.rules.ts";

/**
 * The AgentStop projection: written by the `agent_stop` pipeline's fold, read by the kill switch
 * services. Tenant is the organisation.
 */
export abstract class AgentStopRepository implements StateProjectionStore<AgentStopProjectionState> {
  abstract get(
    key: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<AgentStopProjectionState>>;
  abstract store(
    projection: StoredProjection<AgentStopProjectionState>,
    context: ProjectionStoreContext,
  ): Promise<void>;
  /** Throws `agent_stop_not_found` for an id outside the organisation. */
  abstract getStop(input: { organizationId: string; stopId: string }): Promise<AgentStopRecord>;
  /** The agent's stops, latest request first. */
  abstract findByAgent(input: {
    organizationId: string;
    agentId: string;
    limit: number;
  }): Promise<AgentStopRecord[]>;
  /** The organisation's stops in any of `statuses` (every status when absent), latest first. */
  abstract findByStatuses(input: {
    organizationId: string;
    statuses?: readonly AgentStopStatus[];
    limit: number;
  }): Promise<AgentStopRecord[]>;
}

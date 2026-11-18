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

/** Keyset position in the latest-first stop listing: request moment, then id. */
export type AgentStopPosition = { requestedAt: string; id: string };

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
  /**
   * Writes a just requested stop's row unless the projection wrote it first, so the stop reads
   * back before the worker folds its request. The row's empty cursor lets every event fold onto it.
   */
  abstract seed(input: { stop: AgentStopRecord; at: number }): Promise<void>;
  /** The stop with the id of the last event its row folded; throws as `getStop` does. */
  abstract getStopWithCursor(input: {
    organizationId: string;
    stopId: string;
  }): Promise<{ stop: AgentStopRecord; eventId: string }>;
  /**
   * Writes the fold of a request just sent onto the row, unless the projection folded another
   * event since `eventId`; the cursor is left as it is, so the projection still folds that request.
   */
  abstract advance(input: { stop: AgentStopRecord; eventId: string }): Promise<void>;
  /** Throws `agent_stop_not_found` for an id outside the organisation. */
  abstract getStop(input: { organizationId: string; stopId: string }): Promise<AgentStopRecord>;
  /** The agent's stops, latest request first. */
  abstract findByAgent(input: {
    organizationId: string;
    agentId: string;
    limit: number;
  }): Promise<AgentStopRecord[]>;
  /**
   * The organisation's stops in any of `statuses` (every status when absent), latest first; with
   * `before`, only the stops after that position in the same order.
   */
  abstract findByStatuses(input: {
    organizationId: string;
    statuses?: readonly AgentStopStatus[];
    limit: number;
    before?: AgentStopPosition;
  }): Promise<AgentStopRecord[]>;

  /** Every stop in any of `statuses`, latest first, read `pageSize` at a time to the end. */
  async findAllByStatuses({
    organizationId,
    statuses,
    pageSize = 200,
  }: {
    organizationId: string;
    statuses: readonly AgentStopStatus[];
    pageSize?: number;
  }): Promise<AgentStopRecord[]> {
    const stops: AgentStopRecord[] = [];
    let before: AgentStopPosition | undefined;
    let hasMore = true;
    while (hasMore) {
      const page = await this.findByStatuses({
        organizationId,
        statuses,
        limit: pageSize,
        ...(before ? { before } : {}),
      });
      stops.push(...page);
      const last = page.at(-1);
      hasMore = page.length === pageSize && last !== undefined;
      if (last) before = { requestedAt: last.requestedAt, id: last.id };
    }
    return stops;
  }
}

// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  AGENT_STOP_OPEN_STATUSES,
  type AgentKillSwitchSummary,
  AgentStopNotFoundError,
  type AgentStopPage,
  type AgentStopStatus,
  type AgentStopView,
} from "@langwatch/enterprise-governance-contract";

import type {
  AgentRegistryRepository,
  RegistryEntryPosition,
} from "../../../repositories/agent-registry.repository.ts";
import type { AgentStopRepository } from "../../../repositories/agent-stop.repository.ts";
import {
  type AgentStopRecord,
  decodeStopCursor,
  encodeStopCursor,
  inventoryRowIdsOf,
  viewOfStop,
} from "../rules/agent-stop.rules.ts";
import type { AgentStopPlanService } from "./agent-stop-plan.service.ts";

interface AgentStopReadsDependencies {
  stops: Pick<AgentStopRepository, "findByAgent" | "findByStatuses" | "findAllByStatuses">;
  plans: Pick<AgentStopPlanService, "findPlanCounts">;
  registry: Pick<AgentRegistryRepository, "getEntry" | "listEntries" | "findSourceKeys">;
  pageSize: number;
}

/**
 * What the kill switch reads back: an agent's latest stop, pages of stops, the approvals waiting
 * and the Agents page's summaries.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
export class AgentStopReadsService {
  private constructor(private readonly deps: AgentStopReadsDependencies) {}

  static create(deps: AgentStopReadsDependencies): AgentStopReadsService {
    return new AgentStopReadsService(deps);
  }

  /** The agent's latest stop; refused `agent_stop_not_found` when it was never stopped. */
  async getLatestStop({
    organizationId,
    agentId,
  }: {
    organizationId: string;
    agentId: string;
  }): Promise<AgentStopView> {
    await this.deps.registry.getEntry({ organizationId, id: agentId });
    const [latest] = await this.deps.stops.findByAgent({ organizationId, agentId, limit: 1 });
    if (!latest) throw new AgentStopNotFoundError(agentId);
    return viewOfStop(latest);
  }

  /** One page of stops, latest request first; `next_cursor` is null on the last page. */
  async listStops({
    organizationId,
    statuses,
    limit,
    cursor,
  }: {
    organizationId: string;
    statuses?: readonly AgentStopStatus[];
    limit: number;
    cursor?: string;
  }): Promise<AgentStopPage> {
    const read = await this.deps.stops.findByStatuses({
      organizationId,
      ...(statuses && statuses.length > 0 ? { statuses } : {}),
      limit: limit + 1,
      ...(cursor ? { before: decodeStopCursor(cursor) } : {}),
    });
    const page = read.slice(0, limit);
    const last = page.at(-1);
    return {
      data: page.map(viewOfStop),
      next_cursor: read.length > limit && last ? encodeStopCursor(last) : null,
    };
  }

  /** Every stop waiting for a decision, paged to the end. */
  async findPendingApprovals({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AgentStopView[]> {
    const pending = await this.deps.stops.findAllByStatuses({
      organizationId,
      statuses: ["pending_approval"],
      pageSize: this.deps.pageSize,
    });
    return pending.map(viewOfStop);
  }

  /**
   * One row per active registry agent, plus any other agent holding a plan or an open stop, keyed
   * to its Agents-page row. An agent with no plan yet still gets a row, so its first plan can be set.
   * The Agents page lists every agent, so both reads are paged to the end.
   */
  async findSummaries({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AgentKillSwitchSummary[]> {
    const [counts, open, activeIds] = await Promise.all([
      this.deps.plans.findPlanCounts({ organizationId }),
      this.deps.stops.findAllByStatuses({
        organizationId,
        statuses: AGENT_STOP_OPEN_STATUSES,
        pageSize: this.deps.pageSize,
      }),
      this.findAllActiveAgentIds({ organizationId }),
    ]);
    const openByAgent = new Map<string, AgentStopRecord>();
    for (const stop of open)
      if (!openByAgent.has(stop.agentId)) openByAgent.set(stop.agentId, stop);
    const countByAgent = new Map(counts.map((count) => [count.agentId, count.targetCount]));
    const agentIds = [...new Set([...activeIds, ...countByAgent.keys(), ...openByAgent.keys()])];
    if (agentIds.length === 0) return [];
    const sourceKeys = new Map(
      (await this.deps.registry.findSourceKeys({ organizationId, ids: agentIds })).map((row) => [
        row.id,
        row.sourceKey,
      ]),
    );
    return agentIds.map((agentId) => {
      const sourceKey = sourceKeys.get(agentId);
      const openStop = openByAgent.get(agentId);
      return {
        agentId,
        inventoryRowId: sourceKey ? (inventoryRowIdsOf(sourceKey)[0] ?? null) : null,
        planTargetCount: countByAgent.get(agentId) ?? 0,
        openStop: openStop ? viewOfStop(openStop) : null,
      };
    });
  }

  private async findAllActiveAgentIds({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<string[]> {
    const ids: string[] = [];
    let after: RegistryEntryPosition | undefined;
    let hasMore = true;
    while (hasMore) {
      const page = await this.deps.registry.listEntries({
        organizationId,
        status: "active",
        limit: this.deps.pageSize,
        ...(after ? { after } : {}),
      });
      ids.push(...page.entries.map((entry) => entry.id));
      hasMore = page.hasMore && page.last !== undefined;
      after = page.last;
    }
    return ids;
  }
}

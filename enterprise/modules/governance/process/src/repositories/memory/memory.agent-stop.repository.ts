// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  AgentStopNotFoundError,
  type AgentStopStatus,
} from "@langwatch/enterprise-governance-contract";
import type {
  ProjectionStoreContext,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";

import type { AgentStopProjectionState } from "../../features/kill-switch/eventing/agent-stop.projection.ts";
import {
  AGENT_STOP_PROJECTION_VERSION,
  type AgentStopRecord,
} from "../../features/kill-switch/rules/agent-stop.rules.ts";
import { type AgentStopPosition, AgentStopRepository } from "../agent-stop.repository.ts";

function latestFirst(a: AgentStopPosition, b: AgentStopPosition): number {
  return b.requestedAt.localeCompare(a.requestedAt) || b.id.localeCompare(a.id);
}

export class MemoryAgentStopRepository extends AgentStopRepository {
  private readonly rows = new Map<string, StoredProjection<AgentStopProjectionState>>();

  private constructor() {
    super();
  }

  static create(): MemoryAgentStopRepository {
    return new MemoryAgentStopRepository();
  }

  private key(tenantId: string, stopId: string): string {
    return `${tenantId}:${stopId}`;
  }

  async get(
    key: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<AgentStopProjectionState>> {
    const row = this.rows.get(this.key(String(context.tenantId), key));
    return row ? { kind: "folded", projection: structuredClone(row) } : { kind: "empty" };
  }

  async store(
    projection: StoredProjection<AgentStopProjectionState>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    if (!projection.state) return;
    this.rows.set(
      this.key(String(context.tenantId), projection.state.id),
      structuredClone(projection),
    );
  }

  async seed({ stop, at }: { stop: AgentStopRecord; at: number }): Promise<void> {
    const key = this.key(stop.organizationId, stop.id);
    if (this.rows.has(key)) return;
    this.rows.set(key, {
      state: structuredClone(stop),
      cursor: { acceptedAt: 0, eventId: "" },
      occurredAt: at,
      createdAt: at,
      updatedAt: at,
      version: AGENT_STOP_PROJECTION_VERSION,
    });
  }

  async getStopWithCursor({
    organizationId,
    stopId,
  }: {
    organizationId: string;
    stopId: string;
  }): Promise<{ stop: AgentStopRecord; eventId: string }> {
    const row = this.rows.get(this.key(organizationId, stopId));
    if (!row?.state) throw new AgentStopNotFoundError(stopId);
    return { stop: structuredClone(row.state), eventId: row.cursor.eventId };
  }

  async advance({ stop, eventId }: { stop: AgentStopRecord; eventId: string }): Promise<void> {
    const row = this.rows.get(this.key(stop.organizationId, stop.id));
    if (!row || row.cursor.eventId !== eventId) return;
    row.state = structuredClone(stop);
  }

  private all(organizationId: string): AgentStopRecord[] {
    return [...this.rows.values()]
      .flatMap((row) => (row.state ? [row.state] : []))
      .filter((stop) => stop.organizationId === organizationId)
      .map((stop) => structuredClone(stop));
  }

  async getStop({
    organizationId,
    stopId,
  }: {
    organizationId: string;
    stopId: string;
  }): Promise<AgentStopRecord> {
    const stop = this.all(organizationId).find((candidate) => candidate.id === stopId);
    if (!stop) throw new AgentStopNotFoundError(stopId);
    return stop;
  }

  async findByAgent({
    organizationId,
    agentId,
    limit,
  }: {
    organizationId: string;
    agentId: string;
    limit: number;
  }): Promise<AgentStopRecord[]> {
    return this.all(organizationId)
      .filter((stop) => stop.agentId === agentId)
      .toSorted(latestFirst)
      .slice(0, limit);
  }

  async findByStatuses({
    organizationId,
    statuses,
    limit,
    before,
  }: {
    organizationId: string;
    statuses?: readonly AgentStopStatus[];
    limit: number;
    before?: AgentStopPosition;
  }): Promise<AgentStopRecord[]> {
    return this.all(organizationId)
      .filter((stop) => !statuses || statuses.includes(stop.status))
      .filter((stop) => !before || latestFirst(before, stop) < 0)
      .toSorted(latestFirst)
      .slice(0, limit);
  }
}

import { AccessNotGrantedError, type Authorization } from "@langwatch/authorization";
import type {
  CodingAgentSession,
  CodingAgentSessionBranchRecord,
  CodingAgentUsageCount,
} from "@langwatch/coding-agent-contract";

import {
  CodingAgentSessionRepository,
  type OtherSessionKind,
} from "../coding-agent-session.repository.ts";
import { MemoryCodingAgentDatabase } from "./memory.coding-agent.database.ts";

/** The session aggregate, held in the process rather than in ClickHouse. */
export class MemoryCodingAgentSessionRepository extends CodingAgentSessionRepository {
  static create(memory: MemoryCodingAgentDatabase): MemoryCodingAgentSessionRepository {
    return new MemoryCodingAgentSessionRepository(memory);
  }

  private constructor(private readonly memory: MemoryCodingAgentDatabase) {
    super();
  }

  async upsert(
    row: CodingAgentSession,
    _retentionDays: number,
    appliedEventIds: readonly string[],
  ): Promise<void> {
    const key = MemoryCodingAgentDatabase.key(row.tenantId, row.sessionId);
    const stored = this.memory.sessions.get(key);
    const applied = new Set([...(stored?.appliedEventIds ?? []), ...appliedEventIds]);
    this.memory.sessions.set(key, { row, appliedEventIds: [...applied] });
  }

  async upsertBatch(
    rows: {
      row: CodingAgentSession;
      retentionDays: number;
      appliedEventIds: readonly string[];
    }[],
  ): Promise<void> {
    for (const entry of rows) {
      await this.upsert(entry.row, entry.retentionDays, entry.appliedEventIds);
    }
  }

  async findBySessionId(input: {
    tenantId: string;
    sessionId: string;
    window?: { fromMs: number; toMs: number };
  }): Promise<CodingAgentSession | null> {
    return (await this.findBySessionIdWithApplied(input))?.row ?? null;
  }

  async findBySessionIdWithApplied(input: {
    tenantId: string;
    sessionId: string;
    window?: { fromMs: number; toMs: number };
  }): Promise<{ row: CodingAgentSession; appliedEventIds: string[] } | null> {
    const stored = this.memory.sessions.get(
      MemoryCodingAgentDatabase.key(input.tenantId, input.sessionId),
    );
    if (!stored) return null;
    if (!withinWindow(stored.row.startedAtMs, input.window)) return null;
    return { row: stored.row, appliedEventIds: [...stored.appliedEventIds] };
  }

  async findOtherSessionKind(input: {
    tenantId: string;
    excludeSessionIds: string[];
  }): Promise<OtherSessionKind> {
    const others = this.rows().filter(
      (row) => row.tenantId === input.tenantId && !input.excludeSessionIds.includes(row.sessionId),
    );
    if (others.some((row) => !row.auxiliary)) return "main";
    return others.length > 0 ? "helpers_only" : "none";
  }

  async findManyRecent(input: {
    tenantId: string;
    userId?: string;
    fromMs: number;
    toMs: number;
    limit: number;
  }): Promise<CodingAgentSession[]> {
    return this.rows()
      .filter((row) => row.tenantId === input.tenantId)
      .filter((row) => withinWindow(row.startedAtMs, { fromMs: input.fromMs, toMs: input.toMs }))
      .filter((row) => input.userId === undefined || row.userId === input.userId)
      .filter((row) => !row.auxiliary)
      .toSorted((left, right) => right.startedAtMs - left.startedAtMs)
      .slice(0, input.limit);
  }

  /** The fence applied in memory: own rows whole, a shared tenant's cut to its window. */
  async findManyRecentFenced(input: {
    authorization: Authorization;
    fromMs: number;
    toMs: number;
    limit: number;
  }): Promise<CodingAgentSession[]> {
    // Mirrors `fenceFor` in the clickhouse client, which a memory twin may not import:
    // no own grant with the permission, or a narrowing that matches nothing, is refused.
    const carrying = input.authorization.grants.filter((grant) =>
      grant.permissions.includes("traces:view"),
    );
    if (!carrying.some((grant) => grant.kind === "own")) {
      throw new AccessNotGrantedError("traces:view");
    }
    const grants = carrying.filter(
      (grant) =>
        input.authorization.narrowedTo === undefined ||
        grant.projectId === input.authorization.narrowedTo,
    );
    if (grants.length === 0) {
      throw new AccessNotGrantedError("traces:view");
    }
    const admitted = (row: CodingAgentSession) =>
      grants.some((grant) => {
        if (grant.projectId !== row.tenantId) return false;
        if (grant.kind === "own") return true;
        const window = grant.condition;
        return (
          window?.type === "trace" &&
          row.startedAtMs >= (window.from ?? 0) &&
          (window.until === null || window.until === undefined || row.startedAtMs < window.until)
        );
      });
    return this.rows()
      .filter(admitted)
      .filter((row) => withinWindow(row.startedAtMs, { fromMs: input.fromMs, toMs: input.toMs }))
      .filter((row) => !row.auxiliary)
      .toSorted((left, right) => right.startedAtMs - left.startedAtMs)
      .slice(0, input.limit);
  }

  async findByRepositoryBranch(input: {
    tenantIds: string[];
    repositoryHost: string;
    repositoryOwner: string;
    repositoryName: string;
    branches: string[];
    startedAtFromMs: number;
  }): Promise<CodingAgentSessionBranchRecord[]> {
    const branches = new Set(input.branches);

    return this.rows()
      .filter((row) => input.tenantIds.includes(row.tenantId))
      .filter((row) => row.startedAtMs >= input.startedAtFromMs)
      .filter(
        (row) =>
          row.repositoryHost === input.repositoryHost &&
          row.repositoryOwner === input.repositoryOwner &&
          row.repositoryName === input.repositoryName,
      )
      .filter((row) => [row.gitBranch, ...row.gitBranches].some((branch) => branches.has(branch)))
      .map(branchRecord);
  }

  async findBySessionIds(input: {
    tenantIds: string[];
    sessionIds: string[];
    startedAtFromMs: number;
  }): Promise<CodingAgentSessionBranchRecord[]> {
    return this.rows()
      .filter((row) => input.tenantIds.includes(row.tenantId))
      .filter((row) => input.sessionIds.includes(row.sessionId))
      .filter((row) => row.startedAtMs >= input.startedAtFromMs)
      .map(branchRecord);
  }

  async countUsage(input: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<CodingAgentUsageCount> {
    const rows = this.rows().filter((row) => input.projectIds.includes(row.tenantId));
    const counted = rows.filter(
      (row) => input.since === undefined || row.startedAtMs >= input.since,
    );
    const first = Math.min(...rows.map((row) => row.startedAtMs));
    return {
      sessions: new Set(counted.map((row) => row.sessionId)).size,
      ...(rows.length === 0 ? {} : { firstSessionAt: first }),
    };
  }

  private rows(): CodingAgentSession[] {
    return [...this.memory.sessions.values()].map((stored) => stored.row);
  }
}

/** The bounded, content-free cut a pull-request rollup reads. */
function branchRecord(row: CodingAgentSession): CodingAgentSessionBranchRecord {
  return {
    sessionId: row.sessionId,
    tenantId: row.tenantId,
    startedAtMs: row.startedAtMs,
    lastEventOccurredAtMs: row.lastEventOccurredAt,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheCreationTokens: row.cacheCreationTokens,
    costUsd: row.costUsd,
    agent: row.agent,
    models: [...row.models],
    userId: row.userId,
    gitBranch: row.gitBranch,
    gitBranches: [...row.gitBranches],
    usageByContext: row.usageByContext,
    usageByModel: row.usageByModel,
    title: row.title,
  };
}

function withinWindow(atMs: number, window?: { fromMs: number; toMs: number }): boolean {
  if (!window) return true;
  return atMs >= window.fromMs && atMs <= window.toMs;
}

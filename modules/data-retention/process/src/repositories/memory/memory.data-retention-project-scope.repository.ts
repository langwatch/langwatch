import type { FoldStateRead } from "@langwatch/eventing";

import type {
  DataRetentionProjectScopeRepository,
  DataRetentionProjectScopeState,
} from "../data-retention-project-scope.repository.ts";

/** Data retention's fold of where each project sits, in memory. */
export class MemoryDataRetentionProjectScopeRepository implements DataRetentionProjectScopeRepository {
  static create({
    rows = [],
  }: {
    rows?: readonly DataRetentionProjectScopeState[];
  } = {}): MemoryDataRetentionProjectScopeRepository {
    return new MemoryDataRetentionProjectScopeRepository(rows);
  }

  private readonly rows: Map<string, DataRetentionProjectScopeState>;

  private constructor(rows: readonly DataRetentionProjectScopeState[]) {
    this.rows = new Map(rows.map((state) => [state.projectId, state]));
  }

  async get(aggregateId: string): Promise<FoldStateRead<DataRetentionProjectScopeState>> {
    const state = this.rows.get(aggregateId);
    return state ? { kind: "folded", state } : { kind: "empty" };
  }

  async store(state: DataRetentionProjectScopeState): Promise<void> {
    this.rows.set(state.projectId, state);
  }

  async findProjectIds({
    organizationId,
    teamId,
  }: {
    organizationId: string;
    teamId?: string;
  }): Promise<string[]> {
    return [...this.rows.values()]
      .filter((state) => state.organizationId === organizationId)
      .filter((state) => teamId === undefined || state.teamId === teamId)
      .map((state) => state.projectId);
  }
}

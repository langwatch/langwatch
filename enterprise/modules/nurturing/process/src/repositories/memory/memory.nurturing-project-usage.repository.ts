// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  FoldProjectionStore,
  FoldStateRead,
  ProjectionStoreContext,
} from "@langwatch/eventing";

import {
  emptyProjectUsage,
  foldProjectUsage,
  type NurturingProjectUsageState,
} from "../../rules/nurturing-project-usage.rules.ts";
import {
  EVALUATION_ACTIVITY_OWNER,
  type NurturingProjectUsageOwner,
  type NurturingProjectUsageRepository,
} from "../nurturing-project-usage.repository.ts";

type Row = { state: NurturingProjectUsageState; appliedEventIds: string[] };

const rowKey = (owner: string, projectId: string) => `${projectId}:${owner}`;

/** Nurturing's project-usage rows in memory: one fold store per owner and the read over them. */
export class MemoryNurturingProjectUsageRepository implements NurturingProjectUsageRepository {
  static create(): MemoryNurturingProjectUsageRepository {
    return new MemoryNurturingProjectUsageRepository();
  }

  readonly #rows = new Map<string, Row>();

  private constructor() {}

  forOwner(owner: NurturingProjectUsageOwner): FoldProjectionStore<NurturingProjectUsageState> {
    const rows = this.#rows;
    return {
      async get(projectId: string): Promise<FoldStateRead<NurturingProjectUsageState>> {
        const row = rows.get(rowKey(owner, projectId));
        return row ? { kind: "folded", state: row.state } : { kind: "empty" };
      },
      async getWithApplied(projectId: string) {
        const row = rows.get(rowKey(owner, projectId));
        return row
          ? { state: row.state, appliedEventIds: [...row.appliedEventIds] }
          : { state: null, appliedEventIds: [], miss: "absent" as const };
      },
      async store(state: NurturingProjectUsageState, context: ProjectionStoreContext) {
        rows.set(rowKey(owner, context.key ?? context.aggregateId), {
          state,
          appliedEventIds: [...(context.appliedEventIds ?? [])],
        });
      },
    };
  }

  async recordEvaluationDay({
    projectId,
    occurredAt,
  }: Readonly<{ projectId: string; occurredAt: number }>): Promise<void> {
    const key = rowKey(EVALUATION_ACTIVITY_OWNER, projectId);
    const current = this.#rows.get(key)?.state ?? emptyProjectUsage(projectId);
    const state = foldProjectUsage(current, { kind: "evaluation_completed", occurredAt });
    this.#rows.set(key, { state, appliedEventIds: [] });
  }

  async findForProjects({
    projectIds,
  }: Readonly<{ projectIds: readonly string[] }>): Promise<NurturingProjectUsageState[]> {
    return [...this.#rows.values()]
      .map(({ state }) => state)
      .filter((state) => projectIds.includes(state.projectId));
  }
}

// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  FoldProjectionStore,
  FoldStateRead,
  ProjectionStoreContext,
} from "@langwatch/eventing";

import {
  type NurturingTraceDay,
  type NurturingTraceDaySource,
  traceDayOfKey,
} from "../../rules/nurturing-trace-day.rules.ts";
import type { NurturingTraceDayRepository } from "../nurturing-trace-day.repository.ts";

type StoredTraceDay = Readonly<{
  day: NurturingTraceDay;
  appliedEventIds: readonly string[];
}>;

/** Nurturing's trace-day rows in memory: one per project, day and source, as Postgres keeps them. */
export class MemoryNurturingTraceDayRepository implements NurturingTraceDayRepository {
  static create(): MemoryNurturingTraceDayRepository {
    return new MemoryNurturingTraceDayRepository();
  }

  readonly #rows = new Map<string, StoredTraceDay>();

  private constructor() {}

  forSource(source: NurturingTraceDaySource): FoldProjectionStore<NurturingTraceDay> {
    const rows = this.#rows;
    const rowKey = (key: string) => {
      const { projectId, day } = traceDayOfKey(key);
      return { projectId, day, stored: JSON.stringify([projectId, day, source]) };
    };
    const getWithApplied = async (key: string) => {
      const row = rows.get(rowKey(key).stored);
      return row
        ? { state: row.day, appliedEventIds: [...row.appliedEventIds] }
        : { state: null, appliedEventIds: [], miss: "absent" as const };
    };
    return {
      getWithApplied,
      async get(key: string): Promise<FoldStateRead<NurturingTraceDay>> {
        const { state } = await getWithApplied(key);
        return state ? { kind: "folded", state } : { kind: "empty" };
      },
      async store(state: NurturingTraceDay, context: ProjectionStoreContext) {
        // As Postgres: a day no counted trace reached keeps no row, live or replayed.
        if (state.traceCount === 0 && state.errorCount === 0) return;
        const { projectId, day, stored } = rowKey(context.key ?? context.aggregateId);
        rows.set(stored, {
          day: { ...state, projectId, day },
          appliedEventIds: [...(context.appliedEventIds ?? [])],
        });
      },
    };
  }

  async findForProjects({
    projectIds,
    afterDay,
  }: Readonly<{ projectIds: readonly string[]; afterDay: string }>): Promise<NurturingTraceDay[]> {
    return [...this.#rows.values()]
      .map(({ day }) => day)
      .filter((day) => projectIds.includes(day.projectId) && day.day > afterDay);
  }

  async pruneBefore({
    projectIds,
    beforeDay,
  }: Readonly<{ projectIds: readonly string[]; beforeDay: string }>): Promise<void> {
    this.#deleteWhere((day) => projectIds.includes(day.projectId) && day.day < beforeDay);
  }

  async pruneEveryProjectBefore({ beforeDay }: Readonly<{ beforeDay: string }>): Promise<void> {
    this.#deleteWhere((day) => day.day < beforeDay);
  }

  async pruneProjects({ projectIds }: Readonly<{ projectIds: readonly string[] }>): Promise<void> {
    this.#deleteWhere((day) => projectIds.includes(day.projectId));
  }

  #deleteWhere(matches: (day: NurturingTraceDay) => boolean): void {
    for (const [key, { day }] of this.#rows) {
      if (matches(day)) this.#rows.delete(key);
    }
  }
}

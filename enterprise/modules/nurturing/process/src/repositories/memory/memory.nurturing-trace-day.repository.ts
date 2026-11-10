// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  FoldProjectionStore,
  FoldStateRead,
  ProjectionStoreContext,
} from "@langwatch/eventing";

import type { NurturingTraceDayState } from "../../rules/nurturing-trace-day.rules.ts";
import type {
  NurturingTraceDayRepository,
  NurturingTraceSeeds,
} from "../nurturing-trace-day.repository.ts";

type Row = { state: NurturingTraceDayState; appliedEventIds: string[] };

/** Nurturing's trace-day rows in memory, keyed as the fold keys them. */
export class MemoryNurturingTraceDayRepository implements NurturingTraceDayRepository {
  static create(): MemoryNurturingTraceDayRepository {
    return new MemoryNurturingTraceDayRepository();
  }

  readonly #rows = new Map<string, Row>();

  readonly #seeds = new Map<string, readonly NurturingTraceDayState[]>();

  readonly store: FoldProjectionStore<NurturingTraceDayState>;

  private constructor() {
    const rows = this.#rows;
    this.store = {
      async get(key: string): Promise<FoldStateRead<NurturingTraceDayState>> {
        const row = rows.get(key);
        return row ? { kind: "folded", state: row.state } : { kind: "empty" };
      },
      async getWithApplied(key: string) {
        const row = rows.get(key);
        return row
          ? { state: row.state, appliedEventIds: [...row.appliedEventIds] }
          : { state: null, appliedEventIds: [], miss: "absent" as const };
      },
      async store(state: NurturingTraceDayState, context: ProjectionStoreContext) {
        rows.set(context.key ?? context.aggregateId, {
          state,
          appliedEventIds: [...(context.appliedEventIds ?? [])],
        });
      },
    };
  }

  async findForProjects({
    projectIds,
    afterDay,
  }: Readonly<{ projectIds: readonly string[]; afterDay: string }>): Promise<
    NurturingTraceDayState[]
  > {
    return [...this.#rows.values()]
      .map(({ state }) => state)
      .filter((state) => projectIds.includes(state.projectId) && state.day > afterDay);
  }

  async pruneBefore({
    projectIds,
    beforeDay,
  }: Readonly<{ projectIds: readonly string[]; beforeDay: string }>): Promise<void> {
    for (const [key, { state }] of this.#rows) {
      if (projectIds.includes(state.projectId) && state.day < beforeDay) this.#rows.delete(key);
    }
  }

  async findSeeds({
    projectIds,
    afterDay,
  }: Readonly<{ projectIds: readonly string[]; afterDay: string }>): Promise<NurturingTraceSeeds> {
    const seeded = projectIds.filter((projectId) => this.#seeds.has(projectId));
    return {
      seededProjectIds: seeded,
      days: seeded.flatMap((projectId) =>
        (this.#seeds.get(projectId) ?? []).filter((day) => day.day > afterDay),
      ),
    };
  }

  async recordSeed({
    projectId,
    days,
  }: Readonly<{
    projectId: string;
    seededAt: number;
    days: readonly NurturingTraceDayState[];
  }>): Promise<void> {
    if (!this.#seeds.has(projectId)) this.#seeds.set(projectId, [...days]);
  }
}

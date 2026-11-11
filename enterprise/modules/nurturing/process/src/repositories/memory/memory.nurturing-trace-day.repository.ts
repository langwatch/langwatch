// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingTraceDay } from "../../rules/nurturing-trace-day.rules.ts";
import type { NurturingTraceDayRepository } from "../nurturing-trace-day.repository.ts";

const latest = (a: number | null, b: number | null) =>
  a === null ? b : b === null ? a : Math.max(a, b);

/** Nurturing's trace-day rows in memory, incremented as the Postgres upsert increments them. */
export class MemoryNurturingTraceDayRepository implements NurturingTraceDayRepository {
  static create(): MemoryNurturingTraceDayRepository {
    return new MemoryNurturingTraceDayRepository();
  }

  readonly #days = new Map<string, NurturingTraceDay>();

  private constructor() {}

  async addTraceDays(increments: readonly NurturingTraceDay[]): Promise<void> {
    for (const increment of increments) {
      const key = JSON.stringify([increment.projectId, increment.day]);
      const known = this.#days.get(key);
      this.#days.set(
        key,
        known
          ? {
              ...known,
              traceCount: known.traceCount + increment.traceCount,
              errorCount: known.errorCount + increment.errorCount,
              lastTraceAt: latest(known.lastTraceAt, increment.lastTraceAt),
              lastFailedTraceAt: latest(known.lastFailedTraceAt, increment.lastFailedTraceAt),
            }
          : increment,
      );
    }
  }

  async findForProjects({
    projectIds,
    afterDay,
  }: Readonly<{ projectIds: readonly string[]; afterDay: string }>): Promise<
    NurturingTraceDay[]
  > {
    return [...this.#days.values()].filter(
      (day) => projectIds.includes(day.projectId) && day.day > afterDay,
    );
  }

  async pruneBefore({
    projectIds,
    beforeDay,
  }: Readonly<{ projectIds: readonly string[]; beforeDay: string }>): Promise<void> {
    for (const [key, day] of this.#days) {
      if (projectIds.includes(day.projectId) && day.day < beforeDay) this.#days.delete(key);
    }
  }
}

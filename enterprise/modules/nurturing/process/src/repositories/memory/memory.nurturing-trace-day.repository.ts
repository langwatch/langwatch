// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  type NurturingCountedTrace,
  type NurturingTraceDay,
  traceDayIncrementsOf,
} from "../../rules/nurturing-trace-day.rules.ts";
import type { NurturingTraceDayRepository } from "../nurturing-trace-day.repository.ts";

/** Nurturing's trace-day rows in memory, incremented as the Postgres write increments them. */
export class MemoryNurturingTraceDayRepository implements NurturingTraceDayRepository {
  static create(): MemoryNurturingTraceDayRepository {
    return new MemoryNurturingTraceDayRepository();
  }

  readonly #days = new Map<string, NurturingTraceDay>();

  private constructor() {}

  async countTraces(traces: readonly NurturingCountedTrace[]): Promise<void> {
    for (const increment of traceDayIncrementsOf(traces)) {
      const key = JSON.stringify([increment.projectId, increment.day]);
      const known = this.#days.get(key);
      const lastTimes = [known?.lastTraceAt ?? null, increment.lastTraceAt].filter(
        (t) => t !== null,
      );
      const lastFailedTimes = [
        known?.lastFailedTraceAt ?? null,
        increment.lastFailedTraceAt,
      ].filter((t) => t !== null);
      this.#days.set(
        key,
        known
          ? {
              ...known,
              traceCount: known.traceCount + increment.traceCount,
              errorCount: known.errorCount + increment.errorCount,
              lastTraceAt: lastTimes.length === 0 ? null : Math.max(...lastTimes),
              lastFailedTraceAt: lastFailedTimes.length === 0 ? null : Math.max(...lastFailedTimes),
            }
          : increment,
      );
    }
  }

  async findForProjects({
    projectIds,
    afterDay,
  }: Readonly<{ projectIds: readonly string[]; afterDay: string }>): Promise<NurturingTraceDay[]> {
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

  async pruneProjects({ projectIds }: Readonly<{ projectIds: readonly string[] }>): Promise<void> {
    for (const [key, day] of this.#days) {
      if (projectIds.includes(day.projectId)) this.#days.delete(key);
    }
  }
}

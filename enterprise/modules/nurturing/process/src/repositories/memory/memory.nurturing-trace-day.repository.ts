// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  countedTraceKeyOf,
  type NurturingCountedTrace,
  type NurturingTraceDay,
  traceDayIncrementsOf,
} from "../../rules/nurturing-trace-day.rules.ts";
import type { NurturingTraceDayRepository } from "../nurturing-trace-day.repository.ts";

/** Nurturing's trace-day rows in memory, counted once per trace as the Postgres write counts. */
export class MemoryNurturingTraceDayRepository implements NurturingTraceDayRepository {
  static create(): MemoryNurturingTraceDayRepository {
    return new MemoryNurturingTraceDayRepository();
  }

  readonly #days = new Map<string, NurturingTraceDay>();
  /** Each counted trace's key, with its project and day for the prunes. */
  readonly #counted = new Map<string, Readonly<{ projectId: string; day: string }>>();

  private constructor() {}

  async countTraces(traces: readonly NurturingCountedTrace[]): Promise<void> {
    const fresh = traces.filter((trace) => {
      const key = countedTraceKeyOf(trace);
      if (this.#counted.has(key)) return false;
      this.#counted.set(key, { projectId: trace.projectId, day: trace.day });
      return true;
    });
    for (const increment of traceDayIncrementsOf(fresh)) {
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
    for (const [key, counted] of this.#counted) {
      if (projectIds.includes(counted.projectId) && counted.day < beforeDay) {
        this.#counted.delete(key);
      }
    }
  }

  async pruneProjects({ projectIds }: Readonly<{ projectIds: readonly string[] }>): Promise<void> {
    for (const [key, day] of this.#days) {
      if (projectIds.includes(day.projectId)) this.#days.delete(key);
    }
    for (const [key, counted] of this.#counted) {
      if (projectIds.includes(counted.projectId)) this.#counted.delete(key);
    }
  }
}

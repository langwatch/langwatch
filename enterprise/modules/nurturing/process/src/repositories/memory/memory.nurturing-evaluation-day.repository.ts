// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  NurturingEvaluationDay,
  NurturingEvaluationDayRepository,
} from "../nurturing-evaluation-day.repository.ts";

/** Nurturing's evaluation days in memory, one per project and day, as the Postgres key keeps. */
export class MemoryNurturingEvaluationDayRepository implements NurturingEvaluationDayRepository {
  static create(): MemoryNurturingEvaluationDayRepository {
    return new MemoryNurturingEvaluationDayRepository();
  }

  readonly #days = new Map<string, NurturingEvaluationDay>();

  private constructor() {}

  async recordDay(day: NurturingEvaluationDay): Promise<void> {
    await this.recordDays([day]);
  }

  async recordDays(days: readonly NurturingEvaluationDay[]): Promise<void> {
    for (const { projectId, day } of days) {
      const key = JSON.stringify([projectId, day]);
      if (!this.#days.has(key)) this.#days.set(key, { projectId, day });
    }
  }

  async findForProjects({
    projectIds,
    afterDay,
  }: Readonly<{
    projectIds: readonly string[];
    afterDay: string;
  }>): Promise<NurturingEvaluationDay[]> {
    return [...this.#days.values()].filter(
      ({ projectId, day }) => projectIds.includes(projectId) && day > afterDay,
    );
  }

  async pruneProjects({ projectIds }: Readonly<{ projectIds: readonly string[] }>): Promise<void> {
    for (const [key, { projectId }] of this.#days) {
      if (projectIds.includes(projectId)) this.#days.delete(key);
    }
  }
}

import type { TriggerLatestEvaluation } from "@langwatch/automation-contract";

import { TriggerLatestEvaluationRepository } from "../trigger-latest-evaluation.repository.ts";

/** The memory twin: one snapshot per trigger id, kept only for its own project. */
export class MemoryTriggerLatestEvaluationRepository extends TriggerLatestEvaluationRepository {
  private readonly rows = new Map<string, TriggerLatestEvaluation>();

  private constructor() {
    super();
  }

  static create(): MemoryTriggerLatestEvaluationRepository {
    return new MemoryTriggerLatestEvaluationRepository();
  }

  upsert(input: TriggerLatestEvaluation): Promise<number> {
    const stored = this.rows.get(input.triggerId);
    // The live conflict guard: a row owned by another project is left alone.
    if (stored !== undefined && stored.projectId !== input.projectId) {
      return Promise.resolve(0);
    }
    this.rows.set(input.triggerId, { ...input });
    return Promise.resolve(1);
  }

  findByTriggerId(input: {
    projectId: string;
    triggerId: string;
  }): Promise<TriggerLatestEvaluation[]> {
    const row = this.rows.get(input.triggerId);
    return Promise.resolve(row?.projectId === input.projectId ? [{ ...row }] : []);
  }
}

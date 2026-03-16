import type { DspyStepData, DspyStepSummaryData } from "../types";

export interface DspyStepRepository {
  upsertStep(data: DspyStepData): Promise<void>;
  getStepsByExperiment(
    tenantId: string,
    experimentId: string,
  ): Promise<DspyStepSummaryData[]>;
  getStep(
    tenantId: string,
    experimentId: string,
    runId: string,
    stepIndex: string,
  ): Promise<DspyStepData | null>;
  deleteByExperiment(
    tenantId: string,
    experimentId: string,
  ): Promise<void>;
}

export class NullDspyStepRepository implements DspyStepRepository {
  async upsertStep(): Promise<void> {}
  async getStepsByExperiment(): Promise<DspyStepSummaryData[]> {
    return [];
  }
  async getStep(): Promise<DspyStepData | null> {
    return null;
  }
  async deleteByExperiment(): Promise<void> {}
}

function mergeByHash<T extends { hash: string }>(
  existing: T[],
  incoming: T[],
): T[] {
  const seen = new Set(existing.map((e) => e.hash));
  const merged = [...existing];
  for (const item of incoming) {
    if (!seen.has(item.hash)) {
      merged.push(item);
      seen.add(item.hash);
    }
  }
  return merged;
}

export class InMemoryDspyStepRepository implements DspyStepRepository {
  private readonly store = new Map<string, DspyStepData>();

  async upsertStep(data: DspyStepData): Promise<void> {
    const key = `${data.tenantId}/${data.experimentId}/${data.runId}/${data.stepIndex}`;
    const existing = this.store.get(key);

    if (existing) {
      this.store.set(key, {
        ...data,
        examples: mergeByHash(existing.examples, data.examples),
        llmCalls: mergeByHash(existing.llmCalls, data.llmCalls),
        createdAt: existing.createdAt,
        insertedAt: existing.insertedAt,
      });
    } else {
      this.store.set(key, { ...data });
    }
  }

  async getStepsByExperiment(
    tenantId: string,
    experimentId: string,
  ): Promise<DspyStepSummaryData[]> {
    const results: DspyStepSummaryData[] = [];
    for (const step of this.store.values()) {
      if (step.tenantId === tenantId && step.experimentId === experimentId) {
        let totalTokens = 0;
        let totalCost = 0;
        for (const call of step.llmCalls) {
          totalTokens +=
            (call.prompt_tokens ?? 0) + (call.completion_tokens ?? 0);
          totalCost += call.cost ?? 0;
        }
        results.push({
          tenantId: step.tenantId,
          experimentId: step.experimentId,
          runId: step.runId,
          stepIndex: step.stepIndex,
          workflowVersionId: step.workflowVersionId,
          score: step.score,
          label: step.label,
          optimizerName: step.optimizerName,
          llmCallsTotal: step.llmCalls.length,
          llmCallsTotalTokens: totalTokens,
          llmCallsTotalCost: totalCost,
          createdAt: step.createdAt,
        });
      }
    }
    return results.sort((a, b) => a.createdAt - b.createdAt);
  }

  async getStep(
    tenantId: string,
    experimentId: string,
    runId: string,
    stepIndex: string,
  ): Promise<DspyStepData | null> {
    return this.store.get(`${tenantId}/${experimentId}/${runId}/${stepIndex}`) ?? null;
  }

  async deleteByExperiment(
    tenantId: string,
    experimentId: string,
  ): Promise<void> {
    for (const [key, step] of this.store) {
      if (step.tenantId === tenantId && step.experimentId === experimentId) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }
}

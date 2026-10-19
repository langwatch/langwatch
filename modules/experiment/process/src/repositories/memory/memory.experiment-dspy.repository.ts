import type {
  ExperimentDspyStep,
  ExperimentDspyStepLookup,
  ExperimentDspyStepSummary,
  ExperimentDspyStepsLookup,
} from "@langwatch/experiment-contract";

import { llmSummary, mergeByHash } from "../../rules/experiment-dspy-step.rules.ts";
import { ExperimentDspyRepository } from "../experiment-dspy.repository.ts";

const keyOf = (step: ExperimentDspyStepLookup): string =>
  `${step.tenantId}/${step.experimentId}/${step.runId}/${step.stepIndex}`;

/** DSPy steps in this process's memory; a rewrite merges by hash, as the ClickHouse rows do. */
export class MemoryExperimentDspyRepository extends ExperimentDspyRepository {
  static create(): MemoryExperimentDspyRepository {
    return new MemoryExperimentDspyRepository();
  }

  private readonly steps = new Map<string, ExperimentDspyStep>();

  private constructor() {
    super();
  }

  upsert({ step }: { step: ExperimentDspyStep }): Promise<void> {
    const existing = this.steps.get(keyOf(step));
    this.steps.set(keyOf(step), {
      ...step,
      examples: mergeByHash(existing?.examples ?? [], step.examples),
      llmCalls: mergeByHash(existing?.llmCalls ?? [], step.llmCalls),
      createdAt: existing?.createdAt ?? step.createdAt,
      insertedAt: existing?.insertedAt ?? step.insertedAt,
    });
    return Promise.resolve();
  }

  findAll(input: ExperimentDspyStepsLookup): Promise<ExperimentDspyStepSummary[]> {
    const steps = [...this.steps.values()]
      .filter(
        (step) => step.tenantId === input.tenantId && step.experimentId === input.experimentId,
      )
      .toSorted((left, right) => left.createdAt - right.createdAt);
    return Promise.resolve(
      steps.map((step) => {
        const summary = llmSummary(step.llmCalls);
        return {
          tenantId: step.tenantId,
          experimentId: step.experimentId,
          runId: step.runId,
          stepIndex: step.stepIndex,
          workflowVersionId: step.workflowVersionId,
          score: step.score,
          label: step.label,
          optimizerName: step.optimizerName,
          llmCallsTotal: summary.total,
          llmCallsTotalTokens: summary.tokens,
          llmCallsTotalCost: summary.cost,
          createdAt: step.createdAt,
        };
      }),
    );
  }

  findStep(input: ExperimentDspyStepLookup): Promise<ExperimentDspyStep | null> {
    return Promise.resolve(this.steps.get(keyOf(input)) ?? null);
  }
}

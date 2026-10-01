import type { EvaluationRunData } from "@langwatch/evaluation-contract";
import type { EventingCommands } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { EvaluationLifecyclePipeline } from "../eventing/evaluation-lifecycle.pipeline.ts";
import { buildEvaluationLifecyclePipeline } from "../eventing/evaluation-lifecycle.pipeline.ts";

const logger = createLogger("langwatch:evaluation:lifecycle");

/**
 * Records evaluation's own lifecycle facts on its pipeline: that a person ran one by hand, and that
 * one settled. Nurturing names the admin and counts them from its own side (§9).
 */
export class EvaluationLifecycleService {
  readonly pipeline: EvaluationLifecyclePipeline = buildEvaluationLifecyclePipeline();
  #commands: EventingCommands<EvaluationLifecyclePipeline> | undefined;

  static create(): EvaluationLifecycleService {
    return new EvaluationLifecycleService();
  }

  private constructor() {}

  /** Binds the lifecycle pipeline's own senders. */
  connect(commands: EventingCommands<EvaluationLifecyclePipeline>): void {
    this.#commands = commands;
  }

  /** Never throws: a person's evaluation is not failed for want of a record of it. */
  async ran(input: { userId: string; projectId: string }): Promise<void> {
    try {
      await this.#senders().recordEvaluationRan.send({
        tenantId: input.projectId,
        occurredAt: nowInstant().epochMilliseconds,
        userId: input.userId,
        projectId: input.projectId,
      });
    } catch (error) {
      logger.error(
        { error, projectId: input.projectId },
        "the evaluation ran event was not recorded",
      );
    }
  }

  /** Throws to be retried: the settled evaluation's own subscriber calls it. */
  async completed(input: {
    projectId: string;
    run: Pick<EvaluationRunData, "evaluationId" | "evaluatorType" | "score" | "passed">;
    occurredAt: number;
  }): Promise<void> {
    const { projectId, run } = input;
    await this.#senders().recordEvaluationLifecycleCompleted.send({
      tenantId: projectId,
      occurredAt: input.occurredAt,
      projectId,
      evaluationId: run.evaluationId,
      evaluatorType: run.evaluatorType,
      score: run.score,
      passed: run.passed,
    });
  }

  #senders(): EventingCommands<EvaluationLifecyclePipeline> {
    if (!this.#commands) {
      throw new Error("evaluation_lifecycle pipeline senders are not connected yet");
    }

    return this.#commands;
  }
}

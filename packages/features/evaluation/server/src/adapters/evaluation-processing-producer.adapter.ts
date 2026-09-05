/**
 * The `evaluation_processing` pipeline as a PRODUCER registers it. One definition, two
 * registrations.
 */
import type { AutomationEvaluationSubscriberService } from "@langwatch/automation-contract";
import type { AppendStore, FoldProjectionStore } from "@langwatch/eventing";
import type { EvaluationRunData } from "@langwatch/evaluation-contract";
import type { EvaluationAnalyticsData } from "../projections/evaluation-analytics-fold.projection";
import type { EvaluationAnalyticsRollupRow } from "../projections/evaluation-analytics-rollup.projection";
import { EvaluationExecutionIntentPort } from "../ports/evaluation.port";
import { ExecuteEvaluationCommand } from "../intents/evaluation-execution.intent";
import { EvaluationProcessingAdapter } from "./evaluation-processing.adapter";

/** Why every stand-in below refuses, in the process's own words. */
function producerOnly(processName: string, capability: string): Error {
  return new Error(
    `${processName} registered the evaluation_processing pipeline as a producer only, so it cannot ${capability}. This work belongs to the worker that drains the pipeline.`,
  );
}

/** A fold store that cannot fold, because this process consumes nothing. */
class ProducerOnlyFoldStore<TState> implements FoldProjectionStore<TState> {
  constructor(
    private readonly processName: string,
    private readonly name: string,
  ) {}

  store(): Promise<void> {
    return Promise.reject(producerOnly(this.processName, `write the ${this.name} projection`));
  }

  get(): Promise<TState | null> {
    return Promise.reject(producerOnly(this.processName, `read the ${this.name} projection`));
  }
}

/** An append store that cannot append, for the same reason. */
class ProducerOnlyAppendStore<TRow> implements AppendStore<TRow> {
  constructor(
    private readonly processName: string,
    private readonly name: string,
  ) {}

  append(): Promise<void> {
    return Promise.reject(producerOnly(this.processName, `append to the ${this.name} projection`));
  }
}

/** The execution intent this process does not hold. */
class ProducerOnlyExecutionIntent extends EvaluationExecutionIntentPort {
  constructor(private readonly processName: string) {
    super();
  }

  execute(): Promise<never> {
    return Promise.reject(producerOnly(this.processName, "execute an evaluation"));
  }
}

/** The automation subscribers this process does not hold. */
function producerOnlyAutomations(processName: string): AutomationEvaluationSubscriberService {
  return {
    handleEvaluationTriggerMatch: () =>
      Promise.reject(producerOnly(processName, "match an automation trigger")),
    handleEvaluationGraphTriggerActivity: () =>
      Promise.reject(producerOnly(processName, "sweep graph triggers")),
  } as unknown as AutomationEvaluationSubscriberService;
}

export class EvaluationProcessingProducerAdapter {
  static create(): EvaluationProcessingProducerAdapter {
    return new EvaluationProcessingProducerAdapter();
  }

  /**
   * Builds the evaluation-processing definition for a process that only sends commands on it.
   * `processName` names the refusal, so a stand-in reached by accident says which process
   * reached it rather than reporting an anonymous failure.
   */
  static createPipeline(input: { processName: string }) {
    const { processName } = input;

    return EvaluationProcessingAdapter.createPipeline({
      evalRunStore: new ProducerOnlyFoldStore<EvaluationRunData>(processName, "evaluation run"),
      evaluationAnalyticsStore: new ProducerOnlyFoldStore<EvaluationAnalyticsData>(
        processName,
        "evaluation analytics",
      ),
      evaluationAnalyticsRollupAppendStore:
        new ProducerOnlyAppendStore<EvaluationAnalyticsRollupRow>(
          processName,
          "evaluation analytics rollup",
        ),
      executeEvaluationCommand: ExecuteEvaluationCommand.create(
        new ProducerOnlyExecutionIntent(processName),
      ),
      automations: producerOnlyAutomations(processName),
    });
  }
}

import type { AppendStore, FoldProjectionStore } from "@langwatch/eventing";
import type { AnalyticsService } from "@langwatch/analytics-contract";
import type { EvaluationRunData } from "@langwatch/evaluation-contract";
import type { EvaluationRunProjectionRepository } from "../repositories/evaluation-run-projection.repository.ts";
import type { EvaluationAnalyticsData } from "../projections/evaluation-analytics-fold.projection.ts";
import type { EvaluationAnalyticsRollupRow } from "../projections/evaluation-analytics-rollup.projection.ts";
import type { EvaluationAnalyticsAttributePolicy } from "../app/evaluation.members.ts";
import { EvaluationAnalyticsRollupStore } from "../stores/eventing/evaluation-rollup.store.ts";
import { EvaluationAnalyticsStore } from "../stores/eventing/evaluation-attributes.store.ts";
import { EvaluationRunStore } from "../stores/eventing/evaluation-run.store.ts";

export interface EvaluationEventingStores {
  readonly evalRunStore: FoldProjectionStore<EvaluationRunData>;
  readonly evaluationAnalyticsStore: FoldProjectionStore<EvaluationAnalyticsData>;
  readonly evaluationAnalyticsRollupAppendStore: AppendStore<EvaluationAnalyticsRollupRow>;
}

/**
 * Composes Evaluation's eventing stores from complete feature services.
 * Persistence remains private to this adapter; process roots can decorate a
 * store (for example with Redis) without constructing repositories themselves.
 */
export class EvaluationEventingAdapter {
  static createRunStore(input: {
    evaluation: EvaluationRunProjectionRepository;
    retentionDays: number;
  }): FoldProjectionStore<EvaluationRunData> {
    return EvaluationRunStore.create({
      service: input.evaluation,
      defaultRetentionDays: input.retentionDays,
    });
  }

  static create(input: {
    evaluation: EvaluationRunProjectionRepository;
    analytics: AnalyticsService;
    attributePolicy: EvaluationAnalyticsAttributePolicy;
    retentionDays: number;
  }): EvaluationEventingAdapter {
    return new EvaluationEventingAdapter(input);
  }

  private constructor(
    private readonly input: {
      evaluation: EvaluationRunProjectionRepository;
      analytics: AnalyticsService;
      attributePolicy: EvaluationAnalyticsAttributePolicy;
      retentionDays: number;
    },
  ) {}

  buildStores(): EvaluationEventingStores {
    return {
      evalRunStore: EvaluationRunStore.create({
        service: this.input.evaluation,
        defaultRetentionDays: this.input.retentionDays,
      }),
      evaluationAnalyticsStore: EvaluationAnalyticsStore.create({
        analytics: this.input.analytics,
        attributePolicy: this.input.attributePolicy,
        defaultRetentionDays: this.input.retentionDays,
      }),
      evaluationAnalyticsRollupAppendStore: EvaluationAnalyticsRollupStore.create({
        analytics: this.input.analytics,
        defaultRetentionDays: this.input.retentionDays,
      }),
    };
  }
}

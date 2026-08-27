import type { AppendStore, FoldProjectionStore } from "@langwatch/eventing";
import type { AnalyticsService } from "@langwatch/analytics-contract";
import type { EvaluationRunData, EvaluationService } from "@langwatch/evaluation-contract";
import type { EvaluationAnalyticsData } from "../projections/evaluation-analytics-fold.projection";
import type { EvaluationAnalyticsRollupRow } from "../projections/evaluation-analytics-rollup.projection";
import type { EvaluationAnalyticsAttributePolicy } from "../ports/evaluation.port";
import { EvaluationAnalyticsRollupStore } from "../stores/eventing/evaluation-rollup.store";
import { EvaluationAnalyticsStore } from "../stores/eventing/evaluation-attributes.store";
import { EvaluationRunStore } from "../stores/eventing/evaluation-run.store";

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
    evaluation: EvaluationService;
    retentionDays: number;
  }): FoldProjectionStore<EvaluationRunData> {
    return EvaluationRunStore.create({
      service: input.evaluation,
      defaultRetentionDays: input.retentionDays,
    });
  }

  static create(input: {
    evaluation: EvaluationService;
    analytics: AnalyticsService;
    attributePolicy: EvaluationAnalyticsAttributePolicy;
    retentionDays: number;
  }): EvaluationEventingAdapter {
    return new EvaluationEventingAdapter(input);
  }

  private constructor(
    private readonly input: {
      evaluation: EvaluationService;
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

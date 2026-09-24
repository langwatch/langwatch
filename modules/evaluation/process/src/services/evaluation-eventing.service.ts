import type { AnalyticsApi } from "@langwatch/analytics-contract";
import type { EvaluationRunData } from "@langwatch/evaluation-contract";
import type { AppendStore, FoldProjectionStore } from "@langwatch/eventing";

import type { EvaluationAnalyticsData } from "../eventing/evaluation-analytics-fold.projection.ts";
import type { EvaluationAnalyticsRollupRow } from "../eventing/evaluation-analytics-rollup.projection.ts";
import {
  EvaluationAnalyticsStore,
  type EvaluationAnalyticsFoldWrites,
} from "../eventing/evaluation-attributes.store.ts";
import { EvaluationAnalyticsRollupStore } from "../eventing/evaluation-rollup.store.ts";
import { EvaluationRunStore } from "../eventing/evaluation-run.store.ts";
import type { EvaluationAnalyticsFoldCacheRepository } from "../repositories/evaluation-analytics-fold-cache.repository.ts";
import type { EvaluationRunProjectionRepository } from "../repositories/evaluation-run-projection.repository.ts";

export interface EvaluationEventingStores {
  readonly evalRunStore: FoldProjectionStore<EvaluationRunData>;
  readonly evaluationAnalyticsStore: FoldProjectionStore<EvaluationAnalyticsData>;
  readonly evaluationAnalyticsRollupAppendStore: AppendStore<EvaluationAnalyticsRollupRow>;
}

/** The analytics operations evaluation's folds write through. */
export type EvaluationAnalyticsWrites = EvaluationAnalyticsFoldWrites &
  Pick<AnalyticsApi, "appendEvaluationAnalyticsRollup">;

/**
 * The stores evaluation_processing projects into: the run fold over the run
 * repository, the analytics fold behind its cache, and the rollup append.
 */
export class EvaluationEventingService {
  private constructor(
    private readonly input: {
      runs: EvaluationRunProjectionRepository;
      analytics: EvaluationAnalyticsWrites;
      analyticsFoldCache: EvaluationAnalyticsFoldCacheRepository;
      /** The platform default a tenant with no override is stamped with, read per write. */
      defaultRetentionDays: () => number;
    },
  ) {}

  static create(input: {
    runs: EvaluationRunProjectionRepository;
    analytics: EvaluationAnalyticsWrites;
    analyticsFoldCache: EvaluationAnalyticsFoldCacheRepository;
    defaultRetentionDays: () => number;
  }): EvaluationEventingService {
    return new EvaluationEventingService(input);
  }

  buildStores(): EvaluationEventingStores {
    const { runs, analytics, analyticsFoldCache, defaultRetentionDays } = this.input;

    return {
      evalRunStore: EvaluationRunStore.create({ service: runs, defaultRetentionDays }),
      evaluationAnalyticsStore: analyticsFoldCache.cached(
        EvaluationAnalyticsStore.create({ analytics, defaultRetentionDays }),
      ),
      evaluationAnalyticsRollupAppendStore: EvaluationAnalyticsRollupStore.create({
        analytics,
        defaultRetentionDays,
      }),
    };
  }
}

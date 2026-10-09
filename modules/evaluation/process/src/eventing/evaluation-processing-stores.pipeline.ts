import type { AnalyticsApi } from "@langwatch/analytics-contract";
import type { EvaluationRunData } from "@langwatch/evaluation-contract";
import type {
  AppendStore,
  FoldProjectionStore,
  FoldReadAuthorizer,
  RetentionPolicyResolver,
} from "@langwatch/eventing";

import type { EvaluationAnalyticsFoldCacheRepository } from "../repositories/evaluation-analytics-fold-cache.repository.ts";
import type { EvaluationRunProjectionRepository } from "../repositories/evaluation-run-projection.repository.ts";
import type { EvaluationAnalyticsRollupRow } from "./evaluation-analytics-rollup.projection.ts";
import type { EvaluationAnalyticsData } from "./evaluation-analytics-row.projection.ts";
import {
  EvaluationAnalyticsStore,
  type EvaluationAnalyticsFoldWrites,
} from "./evaluation-attributes.store.ts";
import { EvaluationAnalyticsRollupStore } from "./evaluation-rollup.store.ts";
import { EvaluationRunStore } from "./evaluation-run.store.ts";

interface EvaluationEventingStores {
  readonly evalRunStore: FoldProjectionStore<EvaluationRunData>;
  readonly evaluationAnalyticsStore: FoldProjectionStore<EvaluationAnalyticsData>;
  readonly evaluationAnalyticsRollupAppendStore: AppendStore<EvaluationAnalyticsRollupRow>;
  /** Each tenant's retention, which these stores stamp in place of the default (§9). */
  readonly retention: RetentionPolicyResolver;
}

/** The analytics operations evaluation's folds write through. */
export type EvaluationAnalyticsWrites = EvaluationAnalyticsFoldWrites &
  Pick<AnalyticsApi, "appendEvaluationAnalyticsRollup">;

/**
 * The stores evaluation_processing projects into: the run fold over the run
 * repository, the analytics fold behind its cache, and the rollup append.
 */
export class EvaluationProcessingStoresAdapter {
  private constructor(
    private readonly input: {
      runs: EvaluationRunProjectionRepository;
      analytics: EvaluationAnalyticsWrites;
      analyticsFoldCache: EvaluationAnalyticsFoldCacheRepository;
      /** The platform default a tenant with no override is stamped with, read per write. */
      defaultRetentionDays: () => number;
      tenantRetention: RetentionPolicyResolver;
      /** Mints the own-only proof the run fold's read-back is fenced by. */
      authorizeFoldRead: FoldReadAuthorizer;
    },
  ) {}

  static create(input: {
    runs: EvaluationRunProjectionRepository;
    analytics: EvaluationAnalyticsWrites;
    analyticsFoldCache: EvaluationAnalyticsFoldCacheRepository;
    defaultRetentionDays: () => number;
    tenantRetention: RetentionPolicyResolver;
    authorizeFoldRead: FoldReadAuthorizer;
  }): EvaluationProcessingStoresAdapter {
    return new EvaluationProcessingStoresAdapter(input);
  }

  buildStores(): EvaluationEventingStores {
    const {
      runs,
      analytics,
      analyticsFoldCache,
      defaultRetentionDays,
      tenantRetention,
      authorizeFoldRead,
    } = this.input;

    return {
      evalRunStore: EvaluationRunStore.create({
        service: runs,
        defaultRetentionDays,
        authorize: authorizeFoldRead,
      }),
      evaluationAnalyticsStore: analyticsFoldCache.cached(
        EvaluationAnalyticsStore.create({ analytics, defaultRetentionDays }),
      ),
      evaluationAnalyticsRollupAppendStore: EvaluationAnalyticsRollupStore.create({
        analytics,
        defaultRetentionDays,
      }),
      retention: tenantRetention,
    };
  }
}

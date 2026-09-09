import { featureApi } from "@langwatch/runtime-composition";
import type {
  AnalyticsFeedbacksResult,
  AnalyticsFilterOption,
  AnalyticsReadInput,
  AnalyticsTimeseriesInput,
  AnalyticsTimeseriesResult,
  AnalyticsTopDocumentsResult,
} from "./analytics.timeseries.ts";
import type {
  AnalyticsEvaluationReadInput,
  AnalyticsEvaluationRollupAppendBatchInput,
  AnalyticsEvaluationRollupAppendInput,
  AnalyticsEvaluationRow,
  AnalyticsEvaluationUpsertInput,
} from "./analytics.evaluation.ts";
import type {
  LangWatchQLExecuteInput,
  LangWatchQLProtections,
  LangWatchQLQueryResult,
  LangWatchQLSchema,
  LangWatchQLValidationInput,
} from "./analytics.lwql.ts";

/** The callable analytics capability shared by process peers. */
export interface AnalyticsApi {
  getTimeseries(
    input: AnalyticsTimeseriesInput,
    options?: { readonly maxResultRows?: number },
  ): Promise<AnalyticsTimeseriesResult>;
  getFeedbacks(input: AnalyticsReadInput): Promise<AnalyticsFeedbacksResult>;
  getTopUsedDocuments(input: AnalyticsReadInput): Promise<AnalyticsTopDocumentsResult>;
  filterOptions(input: {
    readonly projectId: string;
    readonly field: string;
    readonly startDate: number;
    readonly endDate: number;
    readonly query?: string;
    readonly key?: string;
    readonly subkey?: string;
    readonly filters?: Record<string, unknown>;
  }): Promise<AnalyticsFilterOption[]>;
  upsertEvaluationAnalytics(input: AnalyticsEvaluationUpsertInput): Promise<void>;
  upsertEvaluationAnalyticsBatch(input: AnalyticsEvaluationUpsertInput[]): Promise<void>;
  tryGetEvaluationAnalytics(input: AnalyticsEvaluationReadInput): Promise<{
    row: AnalyticsEvaluationRow;
    appliedEventIds: string[];
  } | null>;
  appendEvaluationAnalyticsRollup(input: AnalyticsEvaluationRollupAppendInput): Promise<void>;
  appendEvaluationAnalyticsRollupBatch(
    input: AnalyticsEvaluationRollupAppendBatchInput,
  ): Promise<void>;
  isLangWatchQLAvailable(): boolean;
  describeLangWatchQLSchema(input: { protections: LangWatchQLProtections }): LangWatchQLSchema;
  validateLangWatchQL(input: LangWatchQLValidationInput): unknown;
  executeLangWatchQL(input: LangWatchQLExecuteInput): Promise<LangWatchQLQueryResult>;
}

export const AnalyticsApi = featureApi<AnalyticsApi>("analytics");

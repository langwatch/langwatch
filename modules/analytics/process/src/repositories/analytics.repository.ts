import type {
  AnalyticsFeedbackEvent,
  AnalyticsFeedbackPosition,
  AnalyticsFeedbacksResult,
  AnalyticsFilters,
  AnalyticsTopDocumentsResult,
  AnalyticsTable,
  AnalyticsTimeseriesInput,
  AnalyticsTimeseriesResult,
} from "@langwatch/analytics-contract";
import type { Instant } from "@langwatch/time";

export interface AnalyticsTimeseriesQuery {
  readonly table: AnalyticsTable;
  readonly tenantId: string;
  readonly input: AnalyticsTimeseriesInput;
  readonly startDate: Instant;
  readonly endDate: Instant;
  readonly previousPeriodStartDate: Instant;
  readonly adjustedTimeScale: number | "full" | undefined;
  readonly maxResultRows: number | undefined;
}

export interface AnalyticsLegacyReadInput {
  readonly projectId: string;
  readonly startDate: number;
  readonly endDate: number;
  readonly filters?: AnalyticsFilters;
}

export interface AnalyticsFeedbackPageReadInput extends AnalyticsLegacyReadInput {
  /** Resume strictly after this feedback; absent for the newest page. */
  readonly after: AnalyticsFeedbackPosition | undefined;
  readonly limit: number;
}

/** One feedback of a page with the position a following page resumes after. */
export interface AnalyticsFeedbackPageRow {
  readonly event: AnalyticsFeedbackEvent;
  readonly position: AnalyticsFeedbackPosition;
}

/** At most `limit` rows, newest first, and whether the history goes on past them. */
export interface AnalyticsFeedbackPageRead {
  readonly rows: readonly AnalyticsFeedbackPageRow[];
  readonly hasMore: boolean;
}

/** The single persistence capability owned by Analytics. */
export abstract class AnalyticsRepository {
  /**
   * Which physical table answers this read. A persistence decision, not a domain one: it
   * depends on which columns each table carries and which of them the query needs, so it
   * belongs beside the builders that know those tables rather than in the service.
   */
  abstract tableFor(input: AnalyticsTimeseriesInput): AnalyticsTable;

  abstract runTimeseries(query: AnalyticsTimeseriesQuery): Promise<AnalyticsTimeseriesResult>;

  abstract findFeedbackEvents(input: AnalyticsLegacyReadInput): Promise<AnalyticsFeedbacksResult>;

  abstract findFeedbackEventsPage(
    input: AnalyticsFeedbackPageReadInput,
  ): Promise<AnalyticsFeedbackPageRead>;

  abstract findTopDocuments(input: AnalyticsLegacyReadInput): Promise<AnalyticsTopDocumentsResult>;
}

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
import type { Authorization } from "@langwatch/authorization";
import type { Instant } from "@langwatch/time";

export interface AnalyticsTimeseriesQuery {
  readonly table: AnalyticsTable;
  /**
   * The proof the read runs under (ADR-177). Every table reads every project it fences, a
   * shared one inside its grant's window.
   */
  readonly authorization: Authorization;
  readonly input: AnalyticsTimeseriesInput;
  readonly startDate: Instant;
  readonly endDate: Instant;
  readonly previousPeriodStartDate: Instant;
  readonly adjustedTimeScale: number | "full" | undefined;
  readonly maxResultRows: number | undefined;
}

export interface AnalyticsLegacyReadInput {
  readonly projectId: string;
  /** The route's `cost:view` proof (ADR-177 v4.15); its fence picks the tenants read. */
  readonly authorization: Authorization;
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

/** How the read is scoped, beside what it asks for. */
export type AnalyticsTableReadScope = {
  /**
   * The proof reads an aggregate's members, so evaluations are read through their trace's time,
   * not their own: the legacy builder windows the trace (ADR-177 v4.15).
   */
  readsMembers?: boolean;
};

/** The single persistence capability owned by Analytics. */
export abstract class AnalyticsRepository {
  /**
   * Which physical table answers this read. A persistence decision, not a domain one: it
   * depends on which columns each table carries and which of them the query needs, so it
   * belongs beside the builders that know those tables rather than in the service.
   */
  abstract tableFor(
    input: AnalyticsTimeseriesInput,
    scope?: AnalyticsTableReadScope,
  ): AnalyticsTable;

  abstract runTimeseries(query: AnalyticsTimeseriesQuery): Promise<AnalyticsTimeseriesResult>;

  abstract findFeedbackEvents(input: AnalyticsLegacyReadInput): Promise<AnalyticsFeedbacksResult>;

  abstract findFeedbackEventsPage(
    input: AnalyticsFeedbackPageReadInput,
  ): Promise<AnalyticsFeedbackPageRead>;

  abstract findTopDocuments(input: AnalyticsLegacyReadInput): Promise<AnalyticsTopDocumentsResult>;
}

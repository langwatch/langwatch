/**
 * Analytics Comparator
 *
 * Compares analytics results from different backends and logs discrepancies.
 * This class is responsible for detecting differences between ES and CH results
 * during comparison mode.
 */

import { createLogger } from "../../utils/logger";
import type {
  TimeseriesResult,
  FilterDataResult,
  TopDocumentsResult,
  FeedbacksResult,
} from "./types";

/** Tolerance for numeric comparison (5% or at least 1) */
const DEFAULT_TOLERANCE_PERCENT = 0.05;
const MIN_ABSOLUTE_DIFFERENCE = 1;
const MAX_LOGGED_DISCREPANCIES = 10;

/**
 * Analytics Comparator
 *
 * Compares results from different analytics backends and identifies discrepancies.
 */
export class AnalyticsComparator {
  private readonly logger = createLogger("langwatch:analytics:comparator");
  private readonly tolerancePercent: number;

  constructor(tolerancePercent = DEFAULT_TOLERANCE_PERCENT) {
    this.tolerancePercent = tolerancePercent;
  }

  /**
   * Compare results from two backends and log discrepancies
   */
  compare<T>(
    operation: string,
    input: unknown,
    esResult: T,
    chResult: T,
  ): void {
    const discrepancies = this.findDiscrepancies(esResult, chResult);

    if (discrepancies.length > 0) {
      this.logger.warn(
        {
          operation,
          inputSummary: this.summarizeInput(input),
          discrepancyCount: discrepancies.length,
          discrepancies: discrepancies.slice(0, MAX_LOGGED_DISCREPANCIES),
          esResultSample: this.summarize(esResult),
          chResultSample: this.summarize(chResult),
        },
        "Analytics comparison mode: discrepancies found between ES and CH",
      );
    } else {
      this.logger.debug(
        { operation },
        "Analytics comparison mode: ES and CH results match",
      );
    }
  }

  /**
   * Find discrepancies between two results
   */
  findDiscrepancies<T>(esResult: T, chResult: T): string[] {
    const discrepancies: string[] = [];

    if (this.isTimeseriesResult(esResult) && this.isTimeseriesResult(chResult)) {
      this.compareTimeseriesResults(esResult, chResult, discrepancies);
    } else if (
      this.isFilterDataResult(esResult) &&
      this.isFilterDataResult(chResult)
    ) {
      this.compareFilterDataResults(esResult, chResult, discrepancies);
    } else if (
      this.isTopDocumentsResult(esResult) &&
      this.isTopDocumentsResult(chResult)
    ) {
      this.compareTopDocumentsResults(esResult, chResult, discrepancies);
    } else if (
      this.isFeedbacksResult(esResult) &&
      this.isFeedbacksResult(chResult)
    ) {
      this.compareFeedbacksResults(esResult, chResult, discrepancies);
    } else {
      this.logger.warn(
        { esResultType: typeof esResult, chResultType: typeof chResult },
        "Unknown result type for comparison",
      );
    }

    return discrepancies;
  }

  /**
   * Compare timeseries results
   */
  private compareTimeseriesResults(
    esResult: TimeseriesResult,
    chResult: TimeseriesResult,
    discrepancies: string[],
  ): void {
    if (esResult.currentPeriod.length !== chResult.currentPeriod.length) {
      discrepancies.push(
        `Current period bucket count: ES=${esResult.currentPeriod.length}, CH=${chResult.currentPeriod.length}`,
      );
    }

    // Compare values within a tolerance
    const minLength = Math.min(
      esResult.currentPeriod.length,
      chResult.currentPeriod.length,
    );

    for (let i = 0; i < minLength; i++) {
      const esBucket = esResult.currentPeriod[i];
      const chBucket = chResult.currentPeriod[i];

      if (!esBucket || !chBucket) continue;

      for (const key of Object.keys(esBucket)) {
        if (key === "date") continue;

        const esValue = esBucket[key];
        const chValue = chBucket[key];

        if (typeof esValue === "number" && typeof chValue === "number") {
          if (!this.valuesMatch(esValue, chValue)) {
            discrepancies.push(
              `Bucket ${i} key ${key}: ES=${esValue}, CH=${chValue}`,
            );
          }
        }
      }
    }

    // Compare previousPeriod buckets
    if (esResult.previousPeriod.length !== chResult.previousPeriod.length) {
      discrepancies.push(
        `Previous period bucket count: ES=${esResult.previousPeriod.length}, CH=${chResult.previousPeriod.length}`,
      );
    }

    const previousMinLength = Math.min(
      esResult.previousPeriod.length,
      chResult.previousPeriod.length,
    );

    for (let i = 0; i < previousMinLength; i++) {
      const esBucket = esResult.previousPeriod[i];
      const chBucket = chResult.previousPeriod[i];

      if (!esBucket || !chBucket) continue;

      for (const key of Object.keys(esBucket)) {
        if (key === "date") continue;

        const esValue = esBucket[key];
        const chValue = chBucket[key];

        if (typeof esValue === "number" && typeof chValue === "number") {
          if (!this.valuesMatch(esValue, chValue)) {
            discrepancies.push(
              `Previous bucket ${i} key ${key}: ES=${esValue}, CH=${chValue}`,
            );
          }
        }
      }
    }
  }

  /**
   * Compare filter data results
   */
  private compareFilterDataResults(
    esResult: FilterDataResult,
    chResult: FilterDataResult,
    discrepancies: string[],
  ): void {
    if (esResult.options.length !== chResult.options.length) {
      discrepancies.push(
        `Option count: ES=${esResult.options.length}, CH=${chResult.options.length}`,
      );
    }

    // Compare counts for matching fields
    const esOptionMap = new Map(
      esResult.options.map((o) => [o.field, o.count]),
    );

    for (const chOption of chResult.options) {
      const esCount = esOptionMap.get(chOption.field);
      if (esCount !== undefined && !this.valuesMatch(esCount, chOption.count)) {
        discrepancies.push(
          `Option ${chOption.field}: ES=${esCount}, CH=${chOption.count}`,
        );
      }
    }
  }

  /**
   * Check if two numeric values match within tolerance
   */
  private valuesMatch(esValue: number, chValue: number): boolean {
    const tolerance = Math.max(
      Math.abs(esValue * this.tolerancePercent),
      MIN_ABSOLUTE_DIFFERENCE,
    );
    return Math.abs(esValue - chValue) <= tolerance;
  }

  /**
   * Type guard for timeseries results
   */
  private isTimeseriesResult(value: unknown): value is TimeseriesResult {
    return (
      typeof value === "object" &&
      value !== null &&
      "currentPeriod" in value &&
      "previousPeriod" in value
    );
  }

  /**
   * Type guard for filter data results
   */
  private isFilterDataResult(value: unknown): value is FilterDataResult {
    return (
      typeof value === "object" &&
      value !== null &&
      "options" in value &&
      Array.isArray((value as FilterDataResult).options)
    );
  }

  /**
   * Type guard for top documents results
   */
  private isTopDocumentsResult(value: unknown): value is TopDocumentsResult {
    return (
      typeof value === "object" &&
      value !== null &&
      "topDocuments" in value &&
      Array.isArray((value as TopDocumentsResult).topDocuments)
    );
  }

  /**
   * Type guard for feedbacks results
   */
  private isFeedbacksResult(value: unknown): value is FeedbacksResult {
    return (
      typeof value === "object" &&
      value !== null &&
      "events" in value &&
      Array.isArray((value as FeedbacksResult).events)
    );
  }

  /**
   * Compare top documents results
   */
  private compareTopDocumentsResults(
    esResult: TopDocumentsResult,
    chResult: TopDocumentsResult,
    discrepancies: string[],
  ): void {
    if (esResult.topDocuments.length !== chResult.topDocuments.length) {
      discrepancies.push(
        `Top documents count: ES=${esResult.topDocuments.length}, CH=${chResult.topDocuments.length}`,
      );
    }

    if (
      !this.valuesMatch(
        esResult.totalUniqueDocuments,
        chResult.totalUniqueDocuments,
      )
    ) {
      discrepancies.push(
        `Total unique documents: ES=${esResult.totalUniqueDocuments}, CH=${chResult.totalUniqueDocuments}`,
      );
    }

    // Compare counts for matching document IDs
    const esDocMap = new Map(
      esResult.topDocuments.map((d) => [d.documentId, d.count]),
    );

    for (const chDoc of chResult.topDocuments) {
      const esCount = esDocMap.get(chDoc.documentId);
      if (esCount !== undefined && !this.valuesMatch(esCount, chDoc.count)) {
        discrepancies.push(
          `Document ${chDoc.documentId}: ES=${esCount}, CH=${chDoc.count}`,
        );
      }
    }
  }

  /**
   * Compare feedbacks results
   */
  private compareFeedbacksResults(
    esResult: FeedbacksResult,
    chResult: FeedbacksResult,
    discrepancies: string[],
  ): void {
    if (esResult.events.length !== chResult.events.length) {
      discrepancies.push(
        `Feedback events count: ES=${esResult.events.length}, CH=${chResult.events.length}`,
      );
    }

    // Compare event IDs to ensure same events are returned
    const esEventIds = new Set(esResult.events.map((e) => e.event_id));
    const chEventIds = new Set(chResult.events.map((e) => e.event_id));

    const missingInCH = [...esEventIds].filter((id) => !chEventIds.has(id));
    const extraInCH = [...chEventIds].filter((id) => !esEventIds.has(id));

    if (missingInCH.length > 0) {
      discrepancies.push(
        `Events missing in CH: ${missingInCH.slice(0, 5).join(", ")}${missingInCH.length > 5 ? "..." : ""}`,
      );
    }
    if (extraInCH.length > 0) {
      discrepancies.push(
        `Extra events in CH: ${extraInCH.slice(0, 5).join(", ")}${extraInCH.length > 5 ? "..." : ""}`,
      );
    }
  }

  /**
   * Summarize input for logging without exposing PII.
   * Only logs structural information, not actual values.
   */
  private summarizeInput(input: unknown): unknown {
    if (typeof input !== "object" || input === null) {
      return { type: typeof input };
    }

    const obj = input as Record<string, unknown>;
    return {
      keys: Object.keys(obj),
      projectId: obj.projectId ? "[redacted]" : undefined,
      hasFilters: obj.filters !== undefined,
      seriesCount: Array.isArray(obj.series) ? obj.series.length : undefined,
      groupBy: obj.groupBy ? `[${typeof obj.groupBy}]` : undefined,
      timeScale: obj.timeScale,
    };
  }

  /**
   * Summarize a result for logging without exposing PII.
   * Only logs structure and counts, not actual values.
   */
  private summarize<T>(result: T): unknown {
    if (this.isTimeseriesResult(result)) {
      const firstBucket = result.currentPeriod[0];
      return {
        currentPeriodBuckets: result.currentPeriod.length,
        previousPeriodBuckets: result.previousPeriod.length,
        firstCurrentBucket: firstBucket
          ? { date: firstBucket.date, keys: Object.keys(firstBucket) }
          : undefined,
      };
    }
    if (this.isFilterDataResult(result)) {
      return {
        optionCount: result.options.length,
        firstOptions: result.options.slice(0, 3).map((opt) => ({
          field: opt.field,
          countBucket: opt.count > 100 ? "100+" : opt.count > 10 ? "10-100" : "<10",
        })),
      };
    }
    return { type: typeof result };
  }
}

/**
 * Singleton comparator instance
 */
let comparatorInstance: AnalyticsComparator | null = null;

/**
 * Get the analytics comparator singleton
 */
export function getAnalyticsComparator(): AnalyticsComparator {
  if (!comparatorInstance) {
    comparatorInstance = new AnalyticsComparator();
  }
  return comparatorInstance;
}

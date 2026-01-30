/**
 * Compare analytics results between ES and CH with tolerance for numeric differences
 */

import type {
  Discrepancy,
  ComparisonResult,
  TimeseriesResult,
  FilterDataResult,
} from "./types.js";
import type { StructuredQueryResults } from "./analytics-client.js";

const DEFAULT_TOLERANCE = 0.05; // 5%

/**
 * Check if a value is a numeric type
 */
function isNumeric(value: unknown): value is number {
  return typeof value === "number" && !isNaN(value);
}

/**
 * Calculate percent difference between two numbers
 */
function percentDiff(a: number, b: number): number {
  if (a === 0 && b === 0) return 0;
  if (a === 0) return Math.abs(b);
  return Math.abs((a - b) / a);
}

/**
 * Check if two numbers are within tolerance
 */
function withinTolerance(a: number, b: number, tolerance: number): boolean {
  // Allow absolute difference of 1 for small numbers
  const absoluteTolerance = Math.max(Math.abs(a * tolerance), 1);
  return Math.abs(a - b) <= absoluteTolerance;
}

/**
 * Check if a value is considered "empty" (null or undefined)
 * ES returns 0 for missing values, CH omits them (undefined)
 */
function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined;
}

/**
 * Type guard for timeseries results
 */
function isTimeseriesResult(value: unknown): value is TimeseriesResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "currentPeriod" in value &&
    "previousPeriod" in value &&
    Array.isArray((value as TimeseriesResult).currentPeriod)
  );
}

/**
 * Type guard for filter data results
 */
function isFilterDataResult(value: unknown): value is FilterDataResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "options" in value &&
    Array.isArray((value as FilterDataResult).options)
  );
}

/**
 * Compare timeseries results
 */
function compareTimeseriesResults(
  esResult: TimeseriesResult,
  chResult: TimeseriesResult,
  tolerance: number,
): Discrepancy[] {
  const discrepancies: Discrepancy[] = [];

  // Compare bucket counts
  if (esResult.currentPeriod.length !== chResult.currentPeriod.length) {
    discrepancies.push({
      path: "currentPeriod.length",
      esValue: esResult.currentPeriod.length,
      chValue: chResult.currentPeriod.length,
    });
  }

  // Compare values within each bucket
  const minLen = Math.min(
    esResult.currentPeriod.length,
    chResult.currentPeriod.length,
  );

  for (let i = 0; i < minLen; i++) {
    const esBucket = esResult.currentPeriod[i]!;
    const chBucket = chResult.currentPeriod[i]!;

    // Get all keys from both buckets
    const allKeys = new Set([...Object.keys(esBucket), ...Object.keys(chBucket)]);

    for (const key of allKeys) {
      if (key === "date") continue;

      const esValue = esBucket[key];
      const chValue = chBucket[key];

      // Handle missing keys gracefully - treat undefined as equivalent to null
      if (isEmptyValue(esValue) && isEmptyValue(chValue)) {
        continue;
      }

      if (isNumeric(esValue) && isNumeric(chValue)) {
        if (!withinTolerance(esValue, chValue, tolerance)) {
          discrepancies.push({
            path: `currentPeriod[${i}].${key}`,
            esValue,
            chValue,
            percentDiff: percentDiff(esValue, chValue),
          });
        }
      } else if (isEmptyValue(esValue) || isEmptyValue(chValue)) {
        // Treat 0 and null/undefined as equivalent for numeric values
        if (isNumeric(esValue) && esValue === 0 && isEmptyValue(chValue)) {
          continue;
        }
        if (isEmptyValue(esValue) && isNumeric(chValue) && chValue === 0) {
          continue;
        }
        // One is empty, one is not - this is a discrepancy
        discrepancies.push({
          path: `currentPeriod[${i}].${key}`,
          esValue,
          chValue,
        });
      } else {
        // For objects and other types, use deepCompare to handle nested 0/null equivalence
        const nestedDiscrepancies = deepCompare(
          esValue,
          chValue,
          `currentPeriod[${i}].${key}`,
          tolerance,
        );
        discrepancies.push(...nestedDiscrepancies);
      }
    }
  }

  // Also compare previous period if both have data
  if (esResult.previousPeriod.length > 0 || chResult.previousPeriod.length > 0) {
    if (esResult.previousPeriod.length !== chResult.previousPeriod.length) {
      discrepancies.push({
        path: "previousPeriod.length",
        esValue: esResult.previousPeriod.length,
        chValue: chResult.previousPeriod.length,
      });
    }
  }

  return discrepancies;
}

/**
 * Compare filter data results
 */
function compareFilterDataResults(
  esResult: FilterDataResult,
  chResult: FilterDataResult,
  tolerance: number,
): Discrepancy[] {
  const discrepancies: Discrepancy[] = [];

  // Build maps for comparison
  const esOptionMap = new Map(
    esResult.options.map((o) => [o.field, { count: o.count, label: o.label }]),
  );
  const chOptionMap = new Map(
    chResult.options.map((o) => [o.field, { count: o.count, label: o.label }]),
  );

  // Check option count difference
  if (esResult.options.length !== chResult.options.length) {
    discrepancies.push({
      path: "options.length",
      esValue: esResult.options.length,
      chValue: chResult.options.length,
    });
  }

  // Compare ES options against CH
  for (const [field, esData] of esOptionMap) {
    const chData = chOptionMap.get(field);

    if (!chData) {
      discrepancies.push({
        path: `options[${field}]`,
        esValue: esData,
        chValue: null,
      });
    } else if (!withinTolerance(esData.count, chData.count, tolerance)) {
      discrepancies.push({
        path: `options[${field}].count`,
        esValue: esData.count,
        chValue: chData.count,
        percentDiff: percentDiff(esData.count, chData.count),
      });
    }
  }

  // Check for CH options not in ES
  for (const [field, chData] of chOptionMap) {
    if (!esOptionMap.has(field)) {
      discrepancies.push({
        path: `options[${field}]`,
        esValue: null,
        chValue: chData,
      });
    }
  }

  return discrepancies;
}

/**
 * Deep compare two values with numeric tolerance
 */
function deepCompare(
  esValue: unknown,
  chValue: unknown,
  path: string,
  tolerance: number,
): Discrepancy[] {
  const discrepancies: Discrepancy[] = [];

  // Handle null/undefined equivalence
  // Treat null and undefined as equivalent since ES and CH handle missing values differently
  if (isEmptyValue(esValue) && isEmptyValue(chValue)) {
    return [];
  }
  // Treat 0 and null/undefined as equivalent for numeric values
  if (isNumeric(esValue) && esValue === 0 && isEmptyValue(chValue)) {
    return [];
  }
  if (isEmptyValue(esValue) && isNumeric(chValue) && chValue === 0) {
    return [];
  }
  if (isEmptyValue(esValue)) {
    if (!isEmptyValue(chValue)) {
      discrepancies.push({ path, esValue, chValue });
    }
    return discrepancies;
  }
  if (isEmptyValue(chValue)) {
    discrepancies.push({ path, esValue, chValue });
    return discrepancies;
  }

  // Handle numeric comparison with tolerance
  if (isNumeric(esValue) && isNumeric(chValue)) {
    if (!withinTolerance(esValue, chValue, tolerance)) {
      discrepancies.push({
        path,
        esValue,
        chValue,
        percentDiff: percentDiff(esValue, chValue),
      });
    }
    return discrepancies;
  }

  // Handle array comparison
  if (Array.isArray(esValue) && Array.isArray(chValue)) {
    if (esValue.length !== chValue.length) {
      discrepancies.push({
        path: `${path}.length`,
        esValue: esValue.length,
        chValue: chValue.length,
      });
    }

    const minLen = Math.min(esValue.length, chValue.length);
    for (let i = 0; i < minLen; i++) {
      discrepancies.push(
        ...deepCompare(esValue[i], chValue[i], `${path}[${i}]`, tolerance),
      );
    }
    return discrepancies;
  }

  // Handle object comparison
  if (
    typeof esValue === "object" &&
    typeof chValue === "object" &&
    esValue !== null &&
    chValue !== null
  ) {
    const esObj = esValue as Record<string, unknown>;
    const chObj = chValue as Record<string, unknown>;
    const allKeys = new Set([...Object.keys(esObj), ...Object.keys(chObj)]);

    for (const key of allKeys) {
      discrepancies.push(
        ...deepCompare(esObj[key], chObj[key], `${path}.${key}`, tolerance),
      );
    }
    return discrepancies;
  }

  // Direct comparison for primitives
  if (esValue !== chValue) {
    discrepancies.push({ path, esValue, chValue });
  }

  return discrepancies;
}

/**
 * Compare a single query result
 */
export function compareQueryResult(
  queryName: string,
  esResult: unknown,
  chResult: unknown,
  tolerance: number = DEFAULT_TOLERANCE,
): ComparisonResult {
  let discrepancies: Discrepancy[] = [];

  // Handle null results
  if (esResult === null && chResult === null) {
    return {
      passed: true,
      queryName,
      discrepancies: [],
      esResultSummary: null,
      chResultSummary: null,
    };
  }

  if (esResult === null || chResult === null) {
    discrepancies.push({
      path: "result",
      esValue: esResult === null ? "null" : "present",
      chValue: chResult === null ? "null" : "present",
    });
    return {
      passed: false,
      queryName,
      discrepancies,
      esResultSummary: summarizeResult(esResult),
      chResultSummary: summarizeResult(chResult),
    };
  }

  // Use specialized comparators for known types
  if (isTimeseriesResult(esResult) && isTimeseriesResult(chResult)) {
    discrepancies = compareTimeseriesResults(esResult, chResult, tolerance);
  } else if (isFilterDataResult(esResult) && isFilterDataResult(chResult)) {
    discrepancies = compareFilterDataResults(esResult, chResult, tolerance);
  } else {
    // Generic deep comparison
    discrepancies = deepCompare(esResult, chResult, "result", tolerance);
  }

  return {
    passed: discrepancies.length === 0,
    queryName,
    discrepancies,
    esResultSummary: summarizeResult(esResult),
    chResultSummary: summarizeResult(chResult),
  };
}

/**
 * Summarize a result for reporting
 */
function summarizeResult(result: unknown): unknown {
  if (result === null || result === undefined) {
    return null;
  }

  if (isTimeseriesResult(result)) {
    return {
      type: "timeseries",
      currentPeriodBuckets: result.currentPeriod.length,
      previousPeriodBuckets: result.previousPeriod.length,
      firstBucket: result.currentPeriod[0] ?? null,
      lastBucket: result.currentPeriod[result.currentPeriod.length - 1] ?? null,
    };
  }

  if (isFilterDataResult(result)) {
    return {
      type: "filterData",
      optionCount: result.options.length,
      topOptions: result.options.slice(0, 5),
    };
  }

  if (Array.isArray(result)) {
    return {
      type: "array",
      length: result.length,
      sample: result.slice(0, 3),
    };
  }

  if (typeof result === "object") {
    return {
      type: "object",
      keys: Object.keys(result as object),
    };
  }

  return result;
}

/**
 * Compare all structured query results
 */
export function compareAllResults(
  esResults: StructuredQueryResults,
  chResults: StructuredQueryResults,
  tolerance: number = DEFAULT_TOLERANCE,
): ComparisonResult[] {
  const comparisons: ComparisonResult[] = [];

  // Build maps for matching queries by name
  const esQueryMap = new Map(esResults.queries.map((q) => [q.name, q]));
  const chQueryMap = new Map(chResults.queries.map((q) => [q.name, q]));

  // Compare each ES query against CH
  for (const [name, esQuery] of esQueryMap) {
    const chQuery = chQueryMap.get(name);

    if (!chQuery) {
      comparisons.push({
        passed: false,
        queryName: name,
        discrepancies: [
          { path: "query", esValue: "present", chValue: "missing" },
        ],
        esResultSummary: summarizeResult(esQuery.result),
        chResultSummary: null,
      });
    } else {
      // Check for query errors first
      if (esQuery.error || chQuery.error) {
        comparisons.push({
          passed: false,
          queryName: name,
          discrepancies: [
            {
              path: "query_error",
              esValue: esQuery.error ?? "success",
              chValue: chQuery.error ?? "success",
            },
          ],
          esResultSummary: esQuery.error ? { error: esQuery.error } : summarizeResult(esQuery.result),
          chResultSummary: chQuery.error ? { error: chQuery.error } : summarizeResult(chQuery.result),
        });
      } else {
        comparisons.push(
          compareQueryResult(name, esQuery.result, chQuery.result, tolerance),
        );
      }
    }
  }

  // Check for CH queries not in ES
  for (const [name, chQuery] of chQueryMap) {
    if (!esQueryMap.has(name)) {
      comparisons.push({
        passed: false,
        queryName: name,
        discrepancies: [
          { path: "query", esValue: "missing", chValue: "present" },
        ],
        esResultSummary: null,
        chResultSummary: summarizeResult(chQuery.result),
      });
    }
  }

  return comparisons;
}

/**
 * Generate a summary of comparison results
 */
export function generateSummary(comparisons: ComparisonResult[]): {
  totalQueries: number;
  passedQueries: number;
  failedQueries: number;
  overallPassed: boolean;
} {
  const totalQueries = comparisons.length;
  const passedQueries = comparisons.filter((c) => c.passed).length;
  const failedQueries = totalQueries - passedQueries;

  return {
    totalQueries,
    passedQueries,
    failedQueries,
    overallPassed: failedQueries === 0,
  };
}

/**
 * Categorize a query by its name
 */
function categorizeQuery(queryName: string): string {
  if (queryName.startsWith("grouped_by_")) {
    return "Grouping";
  }
  if (queryName.startsWith("filtered_by_")) {
    return "Filters";
  }
  if (queryName.startsWith("timeseries_")) {
    return "Metrics";
  }
  return "Other";
}

/**
 * Generate category statistics
 */
function generateCategoryStats(comparisons: ComparisonResult[]): Map<string, { total: number; passed: number; failed: number }> {
  const stats = new Map<string, { total: number; passed: number; failed: number }>();

  for (const comparison of comparisons) {
    const category = categorizeQuery(comparison.queryName);
    const existing = stats.get(category) ?? { total: 0, passed: 0, failed: 0 };
    existing.total++;
    if (comparison.passed) {
      existing.passed++;
    } else {
      existing.failed++;
    }
    stats.set(category, existing);
  }

  return stats;
}

/**
 * Format comparison results for console output
 */
export function formatComparisonReport(comparisons: ComparisonResult[]): string {
  const lines: string[] = [];
  const summary = generateSummary(comparisons);
  const categoryStats = generateCategoryStats(comparisons);

  lines.push("");
  lines.push("=".repeat(70));
  lines.push("ANALYTICS PARITY CHECK RESULTS");
  lines.push("=".repeat(70));
  lines.push("");

  // Overall summary
  lines.push(`Total Queries: ${summary.totalQueries}`);
  lines.push(`Passed: ${summary.passedQueries}`);
  lines.push(`Failed: ${summary.failedQueries}`);
  lines.push(`Overall: ${summary.overallPassed ? "✓ PASSED" : "✗ FAILED"}`);
  lines.push("");

  // Category summary
  lines.push("-".repeat(70));
  lines.push("CATEGORY BREAKDOWN");
  lines.push("-".repeat(70));
  for (const [category, stats] of categoryStats) {
    const statusIcon = stats.failed === 0 ? "✓" : "✗";
    lines.push(`  ${statusIcon} ${category}: ${stats.passed}/${stats.total} passed`);
  }
  lines.push("");

  // Group comparisons by category
  const categorized = new Map<string, ComparisonResult[]>();
  for (const comparison of comparisons) {
    const category = categorizeQuery(comparison.queryName);
    const existing = categorized.get(category) ?? [];
    existing.push(comparison);
    categorized.set(category, existing);
  }

  // Detailed results by category
  for (const [category, categoryComparisons] of categorized) {
    lines.push("-".repeat(70));
    lines.push(`${category.toUpperCase()} QUERIES`);
    lines.push("-".repeat(70));

    for (const comparison of categoryComparisons) {
      const status = comparison.passed ? "[✓]" : "[✗]";
      const shortName = comparison.queryName
        .replace("timeseries_", "")
        .replace("grouped_by_", "by ")
        .replace("filtered_by_", "by ");
      lines.push(`\n${status} ${shortName}`);

      // Always show the values
      if (comparison.esResultSummary || comparison.chResultSummary) {
        const esSum = comparison.esResultSummary as Record<string, unknown>;
        const chSum = comparison.chResultSummary as Record<string, unknown>;

        // For timeseries, show the first bucket values
        if (esSum?.firstBucket || chSum?.firstBucket) {
          const esBucket = (esSum?.firstBucket ?? {}) as Record<string, unknown>;
          const chBucket = (chSum?.firstBucket ?? {}) as Record<string, unknown>;
          const keys = new Set([...Object.keys(esBucket), ...Object.keys(chBucket)]);
          for (const key of keys) {
            if (key === "date") continue;
            const esVal = formatValue(esBucket[key]);
            const chVal = formatValue(chBucket[key]);
            const match = esVal === chVal ? "" : " ⚠";
            lines.push(`    ${key}: ES=${esVal} | CH=${chVal}${match}`);
          }
        }
      }

      if (!comparison.passed && comparison.discrepancies.length > 0) {
        lines.push("    Discrepancies:");
        for (const disc of comparison.discrepancies.slice(0, 5)) {
          const percentStr = disc.percentDiff !== undefined
            ? ` (${(disc.percentDiff * 100).toFixed(1)}% diff)`
            : "";
          lines.push(`      - ${disc.path}: ES=${JSON.stringify(disc.esValue)} vs CH=${JSON.stringify(disc.chValue)}${percentStr}`);
        }
        if (comparison.discrepancies.length > 5) {
          lines.push(`      ... and ${comparison.discrepancies.length - 5} more`);
        }
      }
    }
    lines.push("");
  }

  lines.push("=".repeat(70));

  return lines.join("\n");
}

/**
 * Format a value for display
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "number") {
    // Round to 4 decimal places for readability
    return Number.isInteger(value) ? String(value) : value.toFixed(4);
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

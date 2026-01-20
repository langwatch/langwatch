/**
 * Batch Evaluation Results - New visualization components
 *
 * This module provides the new V3-style visualization for batch evaluation results.
 * It replaces the old BatchEvaluationV2 components with a cleaner TanStack Table-based UI.
 */

// Main components
export { BatchEvaluationResults } from "./BatchEvaluationResults";
export {
  BatchEvaluationResultsTable,
  ColumnVisibilityButton,
  type ColumnVisibilityButtonProps,
  DEFAULT_HIDDEN_COLUMNS,
} from "./BatchEvaluationResultsTable";
export { type BatchRunSummary, BatchRunsSidebar } from "./BatchRunsSidebar";
// BatchSummaryFooter is still used by ResultsPanel for stop button functionality
export { BatchSummaryFooter } from "./BatchSummaryFooter";
export { BatchTargetCell } from "./BatchTargetCell";
export { BatchTargetHeader } from "./BatchTargetHeader";
export { ComparisonTable } from "./ComparisonTable";
// Aggregate computation
export {
  type BatchEvaluatorAggregate,
  type BatchTargetAggregate,
  computeAllBatchAggregates,
  computeBatchTargetAggregates,
} from "./computeBatchAggregates";
// CSV Export
export {
  buildCsvData,
  buildCsvHeaders,
  type CsvDownloadOptions,
  createCsvDownloader,
  downloadCsv,
  generateCsvContent,
} from "./csvExport";
export { ExpandableDatasetCell } from "./ExpandableDatasetCell";
export { SingleRunTable } from "./SingleRunTable";
// Table utilities
export {
  calculateMinTableWidth,
  getTableStyles,
  inferColumnType,
  ROW_HEIGHT,
} from "./tableUtils";
// Types
export {
  type BatchDatasetColumn,
  type BatchEvaluationData,
  type BatchEvaluatorResult,
  type BatchResultRow,
  type BatchTargetColumn,
  type BatchTargetOutput,
  isImageUrlHeuristic,
  transformBatchEvaluationData,
} from "./types";

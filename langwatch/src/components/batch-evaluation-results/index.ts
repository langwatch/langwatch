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
  DEFAULT_HIDDEN_COLUMNS,
  type ColumnVisibilityButtonProps,
} from "./BatchEvaluationResultsTable";
export { BatchTargetCell } from "./BatchTargetCell";
export { BatchTargetHeader } from "./BatchTargetHeader";
export { ExpandableDatasetCell } from "./ExpandableDatasetCell";
export { BatchRunsSidebar, type BatchRunSummary } from "./BatchRunsSidebar";
// BatchSummaryFooter is still used by ResultsPanel for stop button functionality
export { BatchSummaryFooter } from "./BatchSummaryFooter";

// Aggregate computation
export {
  computeBatchTargetAggregates,
  computeAllBatchAggregates,
  type BatchTargetAggregate,
  type BatchEvaluatorAggregate,
} from "./computeBatchAggregates";

// Types
export {
  transformBatchEvaluationData,
  isImageUrlHeuristic,
  type BatchEvaluationData,
  type BatchResultRow,
  type BatchTargetOutput,
  type BatchEvaluatorResult,
  type BatchTargetColumn,
  type BatchDatasetColumn,
} from "./types";

// CSV Export
export {
  buildCsvHeaders,
  buildCsvData,
  generateCsvContent,
  downloadCsv,
  createCsvDownloader,
  type CsvDownloadOptions,
} from "./csvExport";

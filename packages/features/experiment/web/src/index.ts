export {
  computeAllBatchAggregates,
  computeBatchTargetAggregates,
  type BatchEvaluatorAggregate,
  type BatchTargetAggregate,
} from "./ui/sections/batch-evaluation-results.aggregates";
export { bootstrapMeanCI } from "./model/batch-evaluation-results.bootstrap-ci";
export {
  computeBTLeaderboard,
  type BTLeaderboard,
  type BTLeaderboardEntry,
  type BTLeaderboardOptions,
  type PairwiseComparison,
  type ScoreDifferenceCI,
  type WinMatrix,
} from "./model/batch-evaluation-results.bt-leaderboard";
export {
  axisLabelProps,
  buildAxisLabels,
  chartHeightFor,
  commonLabelPrefix,
  truncateLabel,
} from "./model/batch-evaluation-results.chart-axis";
export {
  comparabilityOf,
  computeComparability,
  groupIndexOf,
  isIncomparable,
  type Comparability,
} from "./model/batch-evaluation-results.comparability";
export {
  buildCsvData,
  buildCsvHeaders,
  createCsvDownloader,
  downloadCsv,
  generateCsvContent,
  type CsvDownloadOptions,
} from "./ui/sections/batch-evaluation-results.csv";
export {
  formatCost,
  formatLeaderboardHeadline,
  type LeaderboardHeadline,
} from "./ui/sections/batch-evaluation-results.headline";
export {
  computeJudgeIndependence,
  computeVerbosityProfile,
  modelFamily,
  VERBOSITY_NOTABLE_RATIO,
  type JudgeIndependence,
  type VerbosityProfile,
} from "./ui/sections/batch-evaluation-results.judge-bias";
export {
  computeMetricStats,
  type MetricStats,
} from "./model/batch-evaluation-results.metric-stats";
export { buildPairwiseComparisons } from "./ui/sections/batch-evaluation-results.pairwise";
export {
  computeParetoDominance,
  type DominanceEdge,
  type ParetoDominance,
  type TradeoffDimension,
} from "./ui/sections/batch-evaluation-results.pareto";
export {
  COLLAPSED_CELL_HEIGHT_PX,
  DEFAULT_ROW_HEIGHT,
  ESTIMATED_ROW_HEIGHT_PX,
  ROW_HEIGHT_OPTIONS,
  type RowHeight,
} from "./model/batch-evaluation-results.row-height";
export {
  INTERRUPTED_THRESHOLD_MS,
  isRunFinished,
} from "./model/batch-evaluation-results.run-state";
export {
  computeSampleAdequacy,
  type SampleAdequacy,
} from "./model/batch-evaluation-results.sample-adequacy";
export { areDistinguishable } from "./model/batch-evaluation-results.score-separation";
export {
  formatTradeoffSummary,
  type TradeoffSummary,
} from "./ui/sections/batch-evaluation-results.tradeoff";
export {
  extractOutputText,
  isImageUrlHeuristic,
  transformBatchEvaluationData,
  type BatchComparisonColumn,
  type BatchComparisonVariant,
  type BatchComparisonVerdict,
  type BatchDatasetColumn,
  type BatchEvaluationData,
  type BatchEvaluatorResult,
  type BatchResultRow,
  type BatchTargetColumn,
  type BatchTargetOutput,
  type ComparisonRunData,
} from "./ui/sections/batch-evaluation-results.types";
export {
  computeVariantMetrics,
  MIN_PRICED_ROWS,
  type VariantMetrics,
} from "./ui/sections/batch-evaluation-results.variant-metrics";
export {
  computeLeaderboardVerdict,
  findCheaperTiedAlternative,
  type CheaperAlternative,
  type LeaderboardVerdict,
} from "./ui/sections/batch-evaluation-results.verdict";
export { winMatrixHasPairwiseDetail } from "./model/batch-evaluation-results.win-matrix";
export { getRunDisplayName } from "./model/batch-evaluation-results.run-display-name";
export { leaderboardFor, useBTLeaderboard } from "./ui/sections/use-bt-leaderboard";
export { useComparisonMode } from "./behavior/use-comparison-mode";
export {
  DEFAULT_RESULT_FIELDS,
  useResultDisplayPreferences,
  type ResultField,
} from "./behavior/use-result-display-preferences";
export { useResultsGrouping, type GroupingSource } from "./ui/sections/use-results-grouping";
export { useVariantMetrics, variantMetricsFor } from "./ui/sections/use-variant-metrics";
export {
  usePairwiseSort,
  type RankedEntry,
  type SortDir,
  type SortKey,
} from "./behavior/use-pairwise-sort";
export {
  BatchEvaluationResultsTable,
  ColumnVisibilityButton,
  DEFAULT_HIDDEN_COLUMNS,
  FieldsButton,
  GroupRowsButton,
  RowHeightButton,
  type ColumnVisibilityButtonProps,
  type FieldsButtonProps,
  type GroupRowsButtonProps,
  type RowHeightButtonProps,
} from "./ui/sections/batch-results/batch-evaluation-results-table";
export {
  BatchRunsSidebar,
  type BatchRunSummary,
} from "./ui/sections/batch-results/batch-runs-sidebar";
export { BatchSummaryFooter } from "./ui/sections/batch-results/batch-summary-footer";
export { BatchTargetCell } from "./ui/sections/batch-results/batch-target-cell";
export { BatchTargetHeader } from "./ui/sections/batch-results/batch-target-header";
export {
  ComparisonCharts,
  computeRunMetrics,
  computeTargetMetrics,
} from "./ui/sections/batch-results/comparison-charts";
export { ComparisonLeaderboardChart } from "./ui/sections/batch-results/comparison-leaderboard-chart";
export { ComparisonTable } from "./ui/sections/batch-results/comparison-table";
export {
  ComparisonWinnerCell,
  resolveWinner,
} from "./ui/sections/batch-results/comparison-winner-cell";
export { ExpandableDatasetCell } from "./ui/sections/batch-results/expandable-dataset-cell";
export {
  LeaderboardStep,
  type LeaderboardStepProps,
} from "./ui/elements/batch-results/leaderboard-step";
export {
  buildTrustChecks,
  LeaderboardTrustPanel,
} from "./ui/sections/batch-results/leaderboard-trust-panel";
export { LeaderboardVerdictPanel } from "./ui/sections/batch-results/leaderboard-verdict-panel";
export {
  DEFAULT_WARN_THRESHOLD,
  PairwiseLeaderboard,
} from "./ui/sections/batch-results/pairwise-leaderboard";
export { ParetoScatterChart } from "./ui/sections/batch-results/pareto-scatter-chart";
export { RunDisplayName } from "./ui/elements/batch-results/run-display-name";
export {
  SingleRunTable,
  trailingComparisonColumns,
} from "./ui/sections/batch-results/single-run-table";
export { TableSkeleton } from "./ui/elements/batch-results/table-skeleton";
export {
  calculateMinTableWidth,
  getTableStyles,
  inferColumnType,
} from "./ui/sections/batch-results/table-utils";
export { TradeoffSummaryLine } from "./ui/sections/batch-results/tradeoff-summary-line";
export { WinRateChart } from "./ui/sections/batch-results/win-rate-chart";
export {
  CostStatsTooltip,
  LatencyStatsTooltip,
  MetricStatsTooltip,
} from "./ui/elements/batch-results/metric-stats-tooltip";

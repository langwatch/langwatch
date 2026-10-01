export {
  computeAllBatchAggregates,
  computeBatchTargetAggregates,
  type BatchEvaluatorAggregate,
  type BatchTargetAggregate,
} from "./ui/sections/batch-evaluation-results.aggregates.ts";
export { bootstrapMeanCI } from "./model/batch-evaluation-results.bootstrap-ci.ts";
export {
  computeBTLeaderboard,
  type BTLeaderboard,
  type BTLeaderboardEntry,
  type BTLeaderboardOptions,
  type PairwiseComparison,
  type ScoreDifferenceCI,
  type WinMatrix,
} from "./model/batch-evaluation-results.bt-leaderboard.ts";
export {
  axisLabelProps,
  buildAxisLabels,
  chartHeightFor,
  commonLabelPrefix,
  truncateLabel,
} from "./model/batch-evaluation-results.chart-axis.ts";
export {
  comparabilityOf,
  computeComparability,
  groupIndexOf,
  isIncomparable,
  type Comparability,
} from "./model/batch-evaluation-results.comparability.ts";
export {
  buildCsvData,
  buildCsvHeaders,
  createCsvDownloader,
  downloadCsv,
  generateCsvContent,
  type CsvDownloadOptions,
} from "./ui/sections/batch-evaluation-results.csv.ts";
export {
  formatCost,
  formatLeaderboardHeadline,
  type LeaderboardHeadline,
} from "./ui/sections/batch-evaluation-results.headline.ts";
export {
  computeJudgeIndependence,
  computeVerbosityProfile,
  modelFamily,
  VERBOSITY_NOTABLE_RATIO,
  type JudgeIndependence,
  type VerbosityProfile,
} from "./ui/sections/batch-evaluation-results.judge-bias.ts";
export { buildPairwiseComparisons } from "./ui/sections/batch-evaluation-results.pairwise.ts";
export {
  computeParetoDominance,
  type DominanceEdge,
  type ParetoDominance,
  type TradeoffDimension,
} from "./ui/sections/batch-evaluation-results.pareto.ts";
export {
  COLLAPSED_CELL_HEIGHT_PX,
  DEFAULT_ROW_HEIGHT,
  ESTIMATED_ROW_HEIGHT_PX,
  ROW_HEIGHT_OPTIONS,
  type RowHeight,
} from "./model/batch-evaluation-results.row-height.ts";
export {
  INTERRUPTED_THRESHOLD_MS,
  isRunFinished,
} from "./model/batch-evaluation-results.run-state.ts";
export {
  computeSampleAdequacy,
  type SampleAdequacy,
} from "./model/batch-evaluation-results.sample-adequacy.ts";
export { areDistinguishable } from "./model/batch-evaluation-results.score-separation.ts";
export {
  formatTradeoffSummary,
  type TradeoffSummary,
} from "./ui/sections/batch-evaluation-results.tradeoff.ts";
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
} from "./ui/sections/batch-evaluation-results.types.ts";
export {
  computeVariantMetrics,
  MIN_PRICED_ROWS,
  type VariantMetrics,
} from "./ui/sections/batch-evaluation-results.variant-metrics.ts";
export {
  computeLeaderboardVerdict,
  findCheaperTiedAlternative,
  type CheaperAlternative,
  type LeaderboardVerdict,
} from "./ui/sections/batch-evaluation-results.verdict.ts";
export { winMatrixHasPairwiseDetail } from "./model/batch-evaluation-results.win-matrix.ts";
export { getRunDisplayName } from "./model/batch-evaluation-results.run-display-name.ts";
export { leaderboardFor, useBTLeaderboard } from "./ui/sections/use-bt-leaderboard.ts";
export { useComparisonMode } from "./behavior/use-comparison-mode.ts";
export {
  DEFAULT_RESULT_FIELDS,
  useResultDisplayPreferences,
  type ResultField,
} from "./behavior/use-result-display-preferences.ts";
export { useResultsGrouping, type GroupingSource } from "./ui/sections/use-results-grouping.ts";
export { useVariantMetrics, variantMetricsFor } from "./ui/sections/use-variant-metrics.ts";
export {
  usePairwiseSort,
  type RankedEntry,
  type SortDir,
  type SortKey,
} from "./behavior/use-pairwise-sort.ts";
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
} from "./ui/sections/batch-results/batch-evaluation-results-table.tsx";
export {
  BatchRunsSidebar,
  type BatchRunSummary,
} from "./ui/sections/batch-results/batch-runs-sidebar.tsx";
export { BatchSummaryFooter } from "./ui/sections/batch-results/batch-summary-footer.tsx";
export { BatchTargetCell } from "./ui/sections/batch-results/batch-target-cell.tsx";
export { BatchTargetHeader } from "./ui/sections/batch-results/batch-target-header.tsx";
export {
  ComparisonCharts,
  computeRunMetrics,
  computeTargetMetrics,
} from "./ui/sections/batch-results/comparison-charts.tsx";
export { ComparisonLeaderboardChart } from "./ui/sections/batch-results/comparison-leaderboard-chart.tsx";
export { ComparisonTable } from "./ui/sections/batch-results/comparison-table.tsx";
export {
  ComparisonWinnerCell,
  resolveWinner,
} from "./ui/sections/batch-results/comparison-winner-cell.tsx";
export { ExpandableDatasetCell } from "./ui/sections/batch-results/expandable-dataset-cell.tsx";
export {
  LeaderboardStep,
  type LeaderboardStepProps,
} from "./ui/elements/batch-results/leaderboard-step.tsx";
export {
  buildTrustChecks,
  LeaderboardTrustPanel,
} from "./ui/sections/batch-results/leaderboard-trust-panel.tsx";
export { LeaderboardVerdictPanel } from "./ui/sections/batch-results/leaderboard-verdict-panel.tsx";
export {
  DEFAULT_WARN_THRESHOLD,
  PairwiseLeaderboard,
} from "./ui/sections/batch-results/pairwise-leaderboard.tsx";
export { ParetoScatterChart } from "./ui/sections/batch-results/pareto-scatter-chart.tsx";
export { RunDisplayName } from "./ui/elements/batch-results/run-display-name.tsx";
export {
  SingleRunTable,
  trailingComparisonColumns,
} from "./ui/sections/batch-results/single-run-table.tsx";
export { TableSkeleton } from "./ui/elements/batch-results/table-skeleton.tsx";
export {
  calculateMinTableWidth,
  getTableStyles,
  inferColumnType,
} from "./ui/sections/batch-results/table-utils.ts";
export { TradeoffSummaryLine } from "./ui/sections/batch-results/tradeoff-summary-line.tsx";
export { WinRateChart } from "./ui/sections/batch-results/win-rate-chart.tsx";
export {
  CostStatsTooltip,
  LatencyStatsTooltip,
  MetricStatsTooltip,
} from "./ui/elements/batch-results/metric-stats-tooltip.tsx";

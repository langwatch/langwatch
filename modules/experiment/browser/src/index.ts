export {
  computeAllBatchAggregates,
  computeBatchTargetAggregates,
  type BatchEvaluatorAggregate,
  type BatchTargetAggregate,
} from "@langwatch/experiment-browser-kit";
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
} from "@langwatch/experiment-browser-kit";
export { INTERRUPTED_THRESHOLD_MS, isRunFinished } from "@langwatch/experiment-browser-kit";
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
} from "@langwatch/experiment-browser-kit";
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
export { getRunDisplayName } from "@langwatch/experiment-browser-kit";
export { leaderboardFor, useBTLeaderboard } from "./ui/sections/use-bt-leaderboard.ts";
export { useComparisonMode } from "./behavior/use-comparison-mode.ts";
export {
  DEFAULT_RESULT_FIELDS,
  useResultDisplayPreferences,
  type ResultField,
} from "@langwatch/experiment-browser-kit";
export { useResultsGrouping, type GroupingSource } from "@langwatch/experiment-browser-kit";
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
} from "@langwatch/experiment-browser-kit";
export { BatchRunsSidebar, type BatchRunSummary } from "@langwatch/experiment-browser-kit";
export { BatchSummaryFooter } from "@langwatch/experiment-browser-kit";
export { BatchTargetCell } from "@langwatch/experiment-browser-kit";
export { BatchTargetHeader } from "@langwatch/experiment-browser-kit";
export {
  ComparisonCharts,
  computeRunMetrics,
  computeTargetMetrics,
} from "./ui/sections/batch-results/comparison-charts.tsx";
export { ComparisonLeaderboardChart } from "./ui/sections/batch-results/comparison-leaderboard-chart.tsx";
export { ComparisonTable } from "@langwatch/experiment-browser-kit";
export { ComparisonWinnerCell, resolveWinner } from "@langwatch/experiment-browser-kit";
export { ExpandableDatasetCell } from "@langwatch/experiment-browser-kit";
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
export { RunDisplayName } from "@langwatch/experiment-browser-kit";
export { SingleRunTable, trailingComparisonColumns } from "@langwatch/experiment-browser-kit";
export { TableSkeleton } from "@langwatch/experiment-browser-kit";
export {
  calculateMinTableWidth,
  getTableStyles,
  inferColumnType,
} from "@langwatch/experiment-browser-kit";
export { TradeoffSummaryLine } from "./ui/sections/batch-results/tradeoff-summary-line.tsx";
export { WinRateChart } from "./ui/sections/batch-results/win-rate-chart.tsx";
export {
  CostStatsTooltip,
  LatencyStatsTooltip,
  MetricStatsTooltip,
} from "./ui/elements/batch-results/metric-stats-tooltip.tsx";

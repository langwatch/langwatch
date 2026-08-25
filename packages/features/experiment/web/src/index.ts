export {
  computeAllBatchAggregates,
  computeBatchTargetAggregates,
  type BatchEvaluatorAggregate,
  type BatchTargetAggregate,
} from "./batch-evaluation-results.aggregates";
export { bootstrapMeanCI } from "./batch-evaluation-results.bootstrap-ci";
export {
  computeBTLeaderboard,
  type BTLeaderboard,
  type BTLeaderboardEntry,
  type BTLeaderboardOptions,
  type PairwiseComparison,
  type ScoreDifferenceCI,
  type WinMatrix,
} from "./batch-evaluation-results.bt-leaderboard";
export {
  axisLabelProps,
  buildAxisLabels,
  chartHeightFor,
  commonLabelPrefix,
  truncateLabel,
} from "./batch-evaluation-results.chart-axis";
export {
  comparabilityOf,
  computeComparability,
  groupIndexOf,
  isIncomparable,
  type Comparability,
} from "./batch-evaluation-results.comparability";
export {
  buildCsvData,
  buildCsvHeaders,
  createCsvDownloader,
  downloadCsv,
  generateCsvContent,
  type CsvDownloadOptions,
} from "./batch-evaluation-results.csv";
export {
  formatCost,
  formatLeaderboardHeadline,
  type LeaderboardHeadline,
} from "./batch-evaluation-results.headline";
export {
  computeJudgeIndependence,
  computeVerbosityProfile,
  modelFamily,
  VERBOSITY_NOTABLE_RATIO,
  type JudgeIndependence,
  type VerbosityProfile,
} from "./batch-evaluation-results.judge-bias";
export {
  computeMetricStats,
  type MetricStats,
} from "./batch-evaluation-results.metric-stats";
export { buildPairwiseComparisons } from "./batch-evaluation-results.pairwise";
export {
  computeParetoDominance,
  type DominanceEdge,
  type ParetoDominance,
  type TradeoffDimension,
} from "./batch-evaluation-results.pareto";
export {
  COLLAPSED_CELL_HEIGHT_PX,
  DEFAULT_ROW_HEIGHT,
  ESTIMATED_ROW_HEIGHT_PX,
  ROW_HEIGHT_OPTIONS,
  type RowHeight,
} from "./batch-evaluation-results.row-height";
export {
  INTERRUPTED_THRESHOLD_MS,
  isRunFinished,
} from "./batch-evaluation-results.run-state";
export {
  computeSampleAdequacy,
  type SampleAdequacy,
} from "./batch-evaluation-results.sample-adequacy";
export { areDistinguishable } from "./batch-evaluation-results.score-separation";
export {
  formatTradeoffSummary,
  type TradeoffSummary,
} from "./batch-evaluation-results.tradeoff";
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
} from "./batch-evaluation-results.types";
export {
  computeVariantMetrics,
  MIN_PRICED_ROWS,
  type VariantMetrics,
} from "./batch-evaluation-results.variant-metrics";
export {
  computeLeaderboardVerdict,
  findCheaperTiedAlternative,
  type CheaperAlternative,
  type LeaderboardVerdict,
} from "./batch-evaluation-results.verdict";
export { winMatrixHasPairwiseDetail } from "./batch-evaluation-results.win-matrix";
export { getRunDisplayName } from "./batch-evaluation-results.run-display-name";
export { leaderboardFor, useBTLeaderboard } from "./use-bt-leaderboard";
export { useComparisonMode } from "./use-comparison-mode";
export {
  DEFAULT_RESULT_FIELDS,
  useResultDisplayPreferences,
  type ResultField,
} from "./use-result-display-preferences";
export { useResultsGrouping, type GroupingSource } from "./use-results-grouping";
export { useVariantMetrics, variantMetricsFor } from "./use-variant-metrics";
export {
  usePairwiseSort,
  type RankedEntry,
  type SortDir,
  type SortKey,
} from "./use-pairwise-sort";

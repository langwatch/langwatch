// Test and process-local compatibility surface. Application callers should use
// the composition adapter and the contract; this subpath is not the package
// server API and is deliberately absent from the root exports.
export * from "./projections/evaluation-analytics-rollup.projection";
export * from "./projections/evaluation-analytics-fold.projection";
export * from "./projections/evaluation-analytics-row.projection";
export * from "./projections/evaluation-run.projection";
export * from "./adapters/evaluation-processing.adapter";
export { EvaluationCommandAdapter } from "./adapters/evaluation-command.adapter";
export * from "./ports/evaluation.port";
export { EvaluationRunStore } from "./stores/eventing/evaluation-run.store";
export { EvaluationAnalyticsStore } from "./stores/eventing/evaluation-attributes.store";
export { EvaluationAnalyticsRollupStore } from "./stores/eventing/evaluation-rollup.store";
export { EvaluationReportedEventService } from "./services/evaluation-reported-event.service";
export { EvaluatorSettingsService } from "./services/evaluator-settings.service";

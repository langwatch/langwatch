// Test and process-local compatibility surface. Application callers should use
// the composition adapter and the contract; this subpath is not the package
// server API and is deliberately absent from the root exports.
export * from "./adapters/evaluation-processing.adapter.ts";
export type { EvaluationAnalyticsData } from "./projections/evaluation-analytics-fold.projection.ts";
export { EvaluationCommandAdapter } from "./adapters/evaluation-command.adapter.ts";
export * from "./ports/evaluation.port.ts";
export { EvaluationReportedEventService } from "./services/evaluation-reported-event.service.ts";
export { EvaluatorSettingsService } from "./services/evaluator-settings.service.ts";

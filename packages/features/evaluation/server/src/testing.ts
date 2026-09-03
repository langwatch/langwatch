// Test and process-local compatibility surface. Application callers should use
// the composition adapter and the contract; this subpath is not the package
// server API and is deliberately absent from the root exports.
export * from "./adapters/evaluation-processing.adapter";
export { EvaluationCommandAdapter } from "./adapters/evaluation-command.adapter";
export * from "./ports/evaluation.port";
export { EvaluationReportedEventService } from "./services/evaluation-reported-event.service";
export { EvaluatorSettingsService } from "./services/evaluator-settings.service";

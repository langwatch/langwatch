export {
  PostgresEvaluatorAdapter,
  type PostgresEvaluatorAdapterOptions,
} from "./adapters/postgres.evaluator.adapter";
export { EvaluatorAuditLogPort, EvaluatorCodeExecutionPort } from "./ports/evaluator.port";

/**
 * The feature's application: the one typed thing its transports are given.
 * Both doors reach the same object, so a rule written on it is the rule both
 * doors get.
 */
export {
  EvaluatorApp,
  EvaluatorWorkflowVersionRequiredError,
  type EvaluatorAppDependencies,
} from "./app/evaluator.app";
export {
  EvaluatorTrpcApi,
  type EvaluatorTrpcContext,
  type EvaluatorTrpcPorts,
} from "./api/app-trpc/evaluator.api";
export {
  EvaluatorReplicationApi,
  type EvaluatorCopyCommand,
  type EvaluatorReplicationPorts,
} from "./api/app-trpc/evaluator-replication.api";
export {
  createEvaluatorsRestApp,
  type EvaluatorAppVariables,
  type EvaluatorOrganizationVariables,
} from "./api/app-rest/evaluator.api";
export {
  apiResponseEvaluatorSchema,
  type ApiResponseEvaluator,
  createEvaluatorInputSchema,
  updateEvaluatorInputSchema,
} from "./api/app-rest/evaluator.schemas";

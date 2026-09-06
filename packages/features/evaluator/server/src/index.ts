export {
  PostgresEvaluatorAdapter,
  type PostgresEvaluatorAdapterOptions,
} from "./adapters/postgres.evaluator.adapter.ts";
export { EvaluatorAuditLogPort, EvaluatorCodeExecutionPort } from "./ports/evaluator.port.ts";
export {
  NlpEvaluatorCodeExecutionAdapter,
  type EvaluatorNlpDispatcher,
} from "./adapters/evaluator-code-execution.adapter.ts";
export {
  PrismaEvaluatorAuditLogAdapter,
  type EvaluatorAuditLogDatabase,
} from "./adapters/prisma.evaluator-change-history.adapter.ts";

/**
 * The feature's application: the one typed thing its transports are given.
 * Both doors reach the same object, so a rule written on it is the rule both
 * doors get.
 */
export {
  EvaluatorApp,
  EvaluatorWorkflowVersionRequiredError,
  type EvaluatorAppDependencies,
} from "./app/evaluator.app.ts";
export {
  EvaluatorTrpcApi,
  type EvaluatorTrpcContext,
  type EvaluatorTrpcPorts,
} from "./transport/api-trpc/evaluator.api.ts";
export {
  EvaluatorReplicationApi,
  type EvaluatorCopyCommand,
  type EvaluatorReplicationPorts,
} from "./transport/api-trpc/evaluator-replication.api.ts";
export {
  createEvaluatorsRestApp,
  type EvaluatorAppVariables,
  type EvaluatorOrganizationVariables,
} from "./transport/api-rest/evaluator.api.ts";
export {
  apiResponseEvaluatorSchema,
  type ApiResponseEvaluator,
  createEvaluatorInputSchema,
  updateEvaluatorInputSchema,
} from "./rules/evaluator-schemas.rules.ts";

export {
  EvaluatorAuditLogPort,
  EvaluatorCodeExecutionPort,
  EvaluatorGraphPort,
} from "./ports/evaluator.port.ts";
export {
  NlpEvaluatorCodeExecutionAdapter,
  type EvaluatorNlpDispatcher,
} from "./adapters/evaluator-code-execution.adapter.ts";
export {
  PrismaEvaluatorAuditLogAdapter,
  type EvaluatorAuditLogDatabase,
} from "./adapters/prisma.evaluator-change-history.adapter.ts";

/**
 * The Postgres-backed service the execution half composes. The repositories
 * behind it stay private to this package, as the shape asks.
 */
export {
  PostgresEvaluatorAdapter,
  type PostgresEvaluatorAdapterOptions,
} from "./adapters/postgres.evaluator.adapter.ts";

/** The replication both `evaluators.copy` and `monitors.copy` share. */
export {
  EvaluatorReplicationService,
  type EvaluatorCopyCommand,
  type EvaluatorReplicationPorts,
} from "./services/evaluator-replication.service.ts";

/**
 * The feature's application: the one typed thing its transports are given.
 * Both doors reach the same object, so a rule written on it is the rule both
 * doors get.
 */
export { EvaluatorApp, type EvaluatorAppDependencies } from "./app/evaluator.app.ts";

/** The two declarations a process mounts, and the wire shapes REST publishes. */
export { evaluatorTrpcTransport } from "./transport/evaluator.trpc.ts";
export { createEvaluatorRest } from "./transport/evaluator.rest.ts";
export {
  apiResponseEvaluatorSchema,
  type ApiResponseEvaluator,
  createEvaluatorInputSchema,
  updateEvaluatorInputSchema,
} from "./rules/evaluator-schemas.rules.ts";

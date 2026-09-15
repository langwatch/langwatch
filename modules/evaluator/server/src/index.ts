/** The one install line a process mounts this module through. */
export { evaluatorServer } from "./evaluator.server.ts";

/** The one replication `evaluators.copy` and `monitors.copy` share. */
export { copyEvaluatorToProject, type EvaluatorCopyResult } from "./evaluator.server.ts";

/**
 * The module's application type: the one typed thing its transports are given. Both doors reach
 * the same object, so a rule written on it is the rule both doors get.
 */
export type { EvaluatorGraph } from "./app/evaluator.app.ts";
export type { EvaluatorNlpDispatcher } from "./services/evaluator-code-execution.service.ts";

/** The replication both `evaluators.copy` and `monitors.copy` share. */
export {
  EvaluatorReplicationService,
  type EvaluatorCopyCommand,
  type EvaluatorReplicationMembers,
} from "./services/evaluator-replication.service.ts";

/** The two declarations a process mounts, and the wire shapes REST publishes. */
export { evaluatorTrpcTransport } from "./transport/evaluator.trpc.ts";
export { createEvaluatorRest } from "./transport/evaluator.rest.ts";
export type { ApiResponseEvaluator } from "./rules/evaluator-schemas.rules.ts";

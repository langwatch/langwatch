import { defineServerModule } from "@langwatch/kernel";
import { EvaluatorApp } from "./app/evaluator.app.ts";
import { evaluatorRepositories } from "./repositories/evaluator-repositories.registry.ts";
import { createEvaluatorRest } from "./transport/evaluator.rest.ts";
import { evaluatorTrpcTransport } from "./transport/evaluator.trpc.ts";
import {
  EvaluatorReplicationService,
  type EvaluatorCopyCommand,
  type EvaluatorReplicationMembers,
} from "./services/evaluator-replication.service.ts";

export const evaluatorServer = defineServerModule("evaluator")
  .withRepositories(evaluatorRepositories)
  .withApp(EvaluatorApp)
  .withTransports(createEvaluatorRest(), evaluatorTrpcTransport);

/** The evaluator a copy produced, as the module answers it. */
export type EvaluatorCopyResult = Awaited<
  ReturnType<EvaluatorReplicationService["copyToProject"]>
>;

/**
 * Copies an evaluator, and the workflow backing it, into another project — the one replication
 * `evaluators.copy` and `monitors.copy` share. The workflow ports are taken per call rather than
 * held, because they resolve their work from the request's own actor.
 */
export function copyEvaluatorToProject(
  input: Readonly<{
    /** How the backing workflow is cloned, and unwound when the insert fails. */
    workflows: EvaluatorReplicationMembers;
    command: EvaluatorCopyCommand;
  }>,
): Promise<EvaluatorCopyResult> {
  return EvaluatorReplicationService.create(input.workflows).copyToProject(input.command);
}

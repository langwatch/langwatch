/**
 * The evaluator module, installed on the worker.
 *
 * A queued evaluation resolves the evaluator it names, runs a code or a native
 * one, and augments the result. It never administers an evaluator, so the four
 * graph writes and the change history refuse by name rather than answering
 * from rows this process composed nothing to read.
 */
import type { WorkflowService } from "@langwatch/workflow-server";
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import {
  evaluatorServer,
  type EvaluatorGraph,
  type EvaluatorNlpDispatcher,
} from "@langwatch/evaluator-server";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createApp, withMemoryRepositories, type ResourceOwnership } from "@langwatch/runtime-composition";
import { UserApi } from "@langwatch/user-contract";

import { nanoid } from "nanoid";

/** The evaluator application this process reads and runs evaluators through. */
export async function installWorkerEvaluator(options: {
  /** The one guarded connection every evaluator row is read on. */
  database: PrismaClient;
  /** Decides whether an actor may reach a replica's own project. */
  permissions: AuthzApi;
  /** The trail one evaluator's change history is read off. */
  auditLog: AuditLogApi;
  /** Names the person behind each row of that history. */
  users: UserApi;
  /** The workflow rows an evaluator's fields, its guard and its run read. */
  workflows: WorkflowService;
  /** Where a code evaluator's one-node Studio graph runs. */
  nlpRuntime: EvaluatorNlpDispatcher;
  /** Resolves a project's default and embeddings models. */
  modelProviders: ModelProviderApi;
  resources: ResourceOwnership;
  /** Names this install in the worker's own resource ledger. */
  name: string;
}) {
  const runtime = await createApp({ role: "api", config: {} })
    .withProvided(AuthzApi, options.permissions)
    .withProvided(AuditLogApi, options.auditLog)
    .withProvided(UserApi, options.users)
    .withModules([withMemoryRepositories(evaluatorServer)])
    .boot();

  options.resources.own(options.name, () => runtime.stop());

  return runtime.module(evaluatorServer).provided;
}

const uncomposedInWorker = (): Error =>
  new Error(
    "The worker composes no evaluator administration graph, so this operation cannot answer.",
  );

/**
 * The workflow and monitor rows an evaluator is entangled with, which only the
 * API process administers. Refused by name rather than answered emptily: an
 * empty answer here would report that an evaluator has no monitors.
 */
class UncomposedEvaluatorGraph implements EvaluatorGraph {
  findLinkedWorkflow(): Promise<never> {
    return Promise.reject(uncomposedInWorker());
  }

  findMonitorsUsingEvaluator(): Promise<never> {
    return Promise.reject(uncomposedInWorker());
  }

  deleteMonitorsUsingEvaluator(): Promise<never> {
    return Promise.reject(uncomposedInWorker());
  }

  archiveLinkedWorkflow(): Promise<never> {
    return Promise.reject(uncomposedInWorker());
  }

  replicateEvaluatorWorkflow(): Promise<never> {
    return Promise.reject(uncomposedInWorker());
  }

  deleteReplicatedWorkflow(): Promise<never> {
    return Promise.reject(uncomposedInWorker());
  }
}

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
import { evaluatorServer, type EvaluatorNlpDispatcher } from "@langwatch/evaluator-server";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createApp, membersFrom, type ResourceOwnership } from "@langwatch/runtime-composition";
import { UserApi } from "@langwatch/user-contract";

/**
 * The evaluator application this process reads and runs evaluators through.
 *
 * EvaluatorApp is not yet converted (its App still declares a bespoke
 * `FeatureSetup` Members bag — `workflows`, `graph`, `nlp`, `modelProviders`,
 * `generateId` — rather than `static readonly reads`), and the v2 builder has
 * no seam left to hand a per-module infrastructure bag through: `withModules`
 * takes only the module list, no second argument, so this does not
 * type-check (TS2322, naming exactly those five members as missing) until
 * Evaluator is converted. `workflows`, `nlpRuntime` and `modelProviders`
 * below are accepted (the call site in worker-production.composition.ts
 * still passes them) but NOT wired. Unlike a converted module's `reads`,
 * this is NOT an eager, named boot refusal: EvaluatorApp constructs with
 * those members silently `undefined`, and only the first call that actually
 * reaches one of them fails. That gap is the module-conversion queue's
 * business, not this composition's.
 */
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
  const runtime = await createApp({
    role: "worker",
    members: membersFrom({ prisma: options.database }),
  })
    .withProvided(AuthzApi, options.permissions)
    .withProvided(AuditLogApi, options.auditLog)
    .withProvided(UserApi, options.users)
    .withModules([evaluatorServer])
    .boot();

  options.resources.own(options.name, () => runtime.stop());

  return runtime.module(evaluatorServer).provided;
}

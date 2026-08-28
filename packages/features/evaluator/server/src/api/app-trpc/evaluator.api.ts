/**
 * Evaluators over the process's tRPC transport.
 *
 * Evaluators are reusable evaluation components:
 * - evaluator: built-in evaluator with custom settings (e.g. langevals/exact_match)
 * - code:      a code evaluator carrying its own code, inputs and outputs
 * - workflow:  a custom evaluator backed by a studio workflow
 *
 *   getAll / getById / getBySlug / getWorkflowFields / getHistory: the reads the
 *                     evaluators page and its drawers make.
 *   create / update / delete:  the editor's writes.
 *   getRelatedEntities / cascadeArchive: the archive confirmation, which names
 *                     the workflow and monitors that go with the evaluator, and
 *                     then archives all three together.
 *   getCopies / copy / pushToCopies / syncFromSource: replication across the
 *                     projects the caller also administers.
 *
 * Transport only: gates, input validation and delegation to `EvaluatorService`.
 *
 * Specs: specs/evaluators/evaluator-management.feature,
 * specs/monitors/replicate-monitor-to-project.feature.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  codeEvaluatorConfigSchema,
  evaluatorTypeSchema,
  type EvaluatorService,
} from "@langwatch/evaluator-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  EvaluatorReplicationApi,
  type EvaluatorReplicationPorts,
} from "./evaluator-replication.api";

type EvaluatorApplication = Readonly<{ evaluators: EvaluatorService }>;

/** The process supplies authentication; authorization arrives as `policy`. */
export type EvaluatorTrpcContext = Readonly<{
  app: EvaluatorApplication;
  /** Whether the caller holds `permission` on that project. */
  can(permission: AuthzPermission, target: Readonly<{ projectId: string }>): Promise<boolean>;
}>;

type EvaluatorTrpcProcedures<
  TContext extends EvaluatorTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one declared permission.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

/**
 * The workflow and monitor records an evaluator is entangled with. Both belong
 * to other features, so the process reads and writes them; each port is handed
 * the request context so it resolves per-request state exactly as before.
 */
export type EvaluatorTrpcPorts = Readonly<{
  /** The evaluator's linked workflow, scoped to the project and not archived. */
  findLinkedWorkflow(
    ctx: EvaluatorTrpcContext,
    input: Readonly<{ workflowId: string; projectId: string }>,
  ): Promise<{ id: string; name: string } | null>;
  /** The monitors in the project that run this evaluator. */
  findMonitorsUsingEvaluator(
    ctx: EvaluatorTrpcContext,
    input: Readonly<{ evaluatorId: string; projectId: string }>,
  ): Promise<{ id: string; name: string }[]>;
  /** Hard-deletes those monitors, and answers how many went. */
  deleteMonitorsUsingEvaluator(
    ctx: EvaluatorTrpcContext,
    input: Readonly<{ evaluatorId: string; projectId: string }>,
  ): Promise<{ count: number }>;
  /** Archives the evaluator's linked workflow. */
  archiveLinkedWorkflow(
    ctx: EvaluatorTrpcContext,
    input: Readonly<{ workflowId: string; projectId: string }>,
  ): Promise<{ id: string }>;
  /** Clones a workflow evaluator's workflow into the target project. */
  replicateEvaluatorWorkflow(
    ctx: EvaluatorTrpcContext,
    input: Readonly<{ workflowId: string; sourceProjectId: string; targetProjectId: string }>,
  ): Promise<string>;
  /** Removes a workflow a replication created, when the evaluator insert fails. */
  deleteReplicatedWorkflow(
    ctx: EvaluatorTrpcContext,
    input: Readonly<{ workflowId: string; projectId: string }>,
  ): Promise<void>;
}>;

const projectScopeSchema = z.object({ projectId: z.string() });

const evaluatorIdInputSchema = z.object({ id: z.string(), projectId: z.string() });

const slugInputSchema = z.object({ slug: z.string(), projectId: z.string() });

const createInputSchema = z.object({
  // Generated server-side so it's present in audit log args for history lookup
  id: z.string().default(() => `evaluator_${nanoid()}`),
  projectId: z.string(),
  name: z.string().min(1).max(255),
  type: evaluatorTypeSchema,
  config: z.record(z.string(), z.unknown()),
  workflowId: z.string().optional(),
});

const updateInputSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string().min(1).max(255).optional(),
  type: evaluatorTypeSchema.optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  workflowId: z.string().nullable().optional(),
});

const evaluatorScopeSchema = z.object({
  projectId: z.string(),
  evaluatorId: z.string(),
});

const copyInputSchema = z.object({
  evaluatorId: z.string(),
  projectId: z.string(),
  sourceProjectId: z.string(),
  // Generated server-side so it's present in audit log args for history lookup
  newEvaluatorId: z.string().default(() => `evaluator_${nanoid()}`),
});

const pushToCopiesInputSchema = z.object({
  projectId: z.string(),
  evaluatorId: z.string(),
  copyIds: z.array(z.string()).optional(),
});

const historyInputSchema = z.object({ evaluatorId: z.string(), projectId: z.string() });

/** Code evaluators carry their program on `config`; nothing else can run one. */
function assertCodeEvaluatorConfig(config: unknown): void {
  const parsed = codeEvaluatorConfigSchema.safeParse(config);
  if (!parsed.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Code evaluators need code, inputs, and outputs",
    });
  }
}

/**
 * Installs the complete `evaluators.*` tRPC surface on a process-owned root.
 * The procedure and the policy are injected by the process so its auth, audit,
 * error, logging and tracing policies wrap every feature procedure
 * consistently.
 */
export class EvaluatorTrpcApi {
  static create<
    TContext extends EvaluatorTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: EvaluatorTrpcProcedures<TContext, TOptions, TRoot>,
    ports: EvaluatorTrpcPorts,
  ) {
    const { protected: procedure, policy } = procedures;

    /** The replication ports, bound to one request's context. */
    const replicationPorts = (ctx: EvaluatorTrpcContext): EvaluatorReplicationPorts => ({
      replicateEvaluatorWorkflow: (input) => ports.replicateEvaluatorWorkflow(ctx, input),
      deleteReplicatedWorkflow: (input) => ports.deleteReplicatedWorkflow(ctx, input),
    });

    return trpc.router({
      /**
       * Gets all evaluators for a project with computed fields.
       * Fields include required/optional inputs derived from evaluator type.
       */
      getAll: policy("evaluations:view")(procedure.input(projectScopeSchema)).query(
        async ({ ctx, input }) => {
          return await ctx.app.evaluators.getAllWithFields({
            projectId: input.projectId,
          });
        },
      ),

      /**
       * Gets a single evaluator by ID with computed fields.
       * Fields include required/optional inputs derived from evaluator type.
       */
      getById: policy("evaluations:view")(procedure.input(evaluatorIdInputSchema)).query(
        async ({ ctx, input }) => {
          return await ctx.app.evaluators.tryGetByIdWithFields({
            id: input.id,
            projectId: input.projectId,
          });
        },
      ),

      /** Gets a single evaluator by slug. */
      getBySlug: policy("evaluations:view")(procedure.input(slugInputSchema)).query(
        async ({ ctx, input }) => {
          return await ctx.app.evaluators.tryGetBySlug({
            slug: input.slug,
            projectId: input.projectId,
          });
        },
      ),

      /** Creates a new evaluator. */
      create: policy("evaluations:manage")(procedure.input(createInputSchema)).mutation(
        async ({ ctx, input }) => {
          if (input.type === "code") {
            assertCodeEvaluatorConfig(input.config);
          }

          // If workflowId is provided, check if an evaluator already exists for this workflow
          if (input.workflowId) {
            const existingEvaluator = await ctx.app.evaluators.tryGetByWorkflow({
              workflowId: input.workflowId,
              projectId: input.projectId,
            });

            if (existingEvaluator) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `An evaluator already exists for this workflow: "${existingEvaluator.name}"`,
              });
            }
          }

          return await ctx.app.evaluators.create({
            id: input.id,
            projectId: input.projectId,
            name: input.name,
            type: input.type,
            config: input.config,
            workflowId: input.workflowId,
          });
        },
      ),

      /** Updates an existing evaluator. */
      update: policy("evaluations:manage")(procedure.input(updateInputSchema)).mutation(
        async ({ ctx, input }) => {
          if (input.type === "code" && input.config !== undefined) {
            assertCodeEvaluatorConfig(input.config);
          }
          return await ctx.app.evaluators.update({
            id: input.id,
            projectId: input.projectId,
            data: {
              ...(input.name !== undefined && { name: input.name }),
              ...(input.type !== undefined && { type: input.type }),
              ...(input.config !== undefined && {
                config: input.config,
              }),
              ...(input.workflowId !== undefined && {
                workflowId: input.workflowId,
              }),
            },
          });
        },
      ),

      /**
       * Gets entities related to an evaluator for cascade archive warning.
       * Returns linked workflow and monitors that would be affected.
       */
      getRelatedEntities: policy("evaluations:view")(procedure.input(evaluatorIdInputSchema)).query(
        async ({ ctx, input }) => {
          const evaluator = await ctx.app.evaluators.tryGetById({
            id: input.id,
            projectId: input.projectId,
          });

          // Find the linked workflow (if any)
          const workflow = evaluator?.workflowId
            ? await ports.findLinkedWorkflow(ctx, {
                workflowId: evaluator.workflowId,
                projectId: input.projectId,
              })
            : null;

          // Find monitors using this evaluator
          const monitors = await ports.findMonitorsUsingEvaluator(ctx, {
            evaluatorId: input.id,
            projectId: input.projectId,
          });

          return { workflow, monitors };
        },
      ),

      /**
       * Archives an evaluator and all related entities in a transaction.
       * - Archives linked workflow
       * - Deletes monitors using this evaluator (hard delete)
       */
      cascadeArchive: policy("evaluations:manage")(
        procedure.input(evaluatorIdInputSchema),
      ).mutation(async ({ ctx, input }) => {
        const evaluator = await ctx.app.evaluators.getById({
          id: input.id,
          projectId: input.projectId,
        });
        const deletedMonitors = await ports.deleteMonitorsUsingEvaluator(ctx, {
          evaluatorId: input.id,
          projectId: input.projectId,
        });
        const archivedEvaluator = await ctx.app.evaluators.archive({
          id: input.id,
          projectId: input.projectId,
        });

        let archivedWorkflow = null;
        if (evaluator.workflowId) {
          archivedWorkflow = await ports.archiveLinkedWorkflow(ctx, {
            workflowId: evaluator.workflowId,
            projectId: input.projectId,
          });
        }
        return {
          evaluator: archivedEvaluator,
          archivedWorkflow,
          deletedMonitorsCount: deletedMonitors.count,
        };
      }),

      /** Soft deletes an evaluator. */
      delete: policy("evaluations:manage")(procedure.input(evaluatorIdInputSchema)).mutation(
        async ({ ctx, input }) => {
          return await ctx.app.evaluators.archive({
            id: input.id,
            projectId: input.projectId,
          });
        },
      ),

      /**
       * Gets workflow fields for a workflow-based evaluator.
       * Returns the entry node outputs from the linked workflow.
       * These represent the fields that need to be mapped from trace data.
       */
      getWorkflowFields: policy("evaluations:view")(procedure.input(evaluatorIdInputSchema)).query(
        async ({ ctx, input }) => {
          // Fetch the evaluator first, then scope its workflow to the same project.
          return ctx.app.evaluators.getWorkflowFields(input);
        },
      ),

      /** Get copies of an evaluator (replicas in other projects) for push selection. */
      getCopies: policy("evaluations:view")(procedure.input(evaluatorScopeSchema)).query(
        async ({ ctx, input }) => {
          const copies = await ctx.app.evaluators.getCopies(input);

          const authorizedCopies = await Promise.all(
            copies.map(async (c) => ({
              copy: c,
              hasPermission: await ctx.can("evaluations:view", { projectId: c.projectId }),
            })),
          ).then((results) => results.filter((r) => r.hasPermission).map((r) => r.copy));

          return authorizedCopies;
        },
      ),

      /** Copy (replicate) an evaluator to another project. */
      copy: policy("evaluations:manage")(procedure.input(copyInputSchema)).mutation(
        async ({ ctx, input }) => {
          const hasSourcePermission = await ctx.can("evaluations:manage", {
            projectId: input.sourceProjectId,
          });
          if (!hasSourcePermission) {
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: "You do not have permission to manage evaluations in the source project",
            });
          }

          return await EvaluatorReplicationApi.create(replicationPorts(ctx)).copyToProject({
            evaluators: ctx.app.evaluators,
            evaluatorId: input.evaluatorId,
            sourceProjectId: input.sourceProjectId,
            targetProjectId: input.projectId,
            newEvaluatorId: input.newEvaluatorId,
          });
        },
      ),

      /** Push source evaluator config to selected copies (replicas). */
      pushToCopies: policy("evaluations:manage")(procedure.input(pushToCopiesInputSchema)).mutation(
        async ({ ctx, input }) => {
          const copies = await ctx.app.evaluators.getCopies(input);
          const copiesToPush = input.copyIds
            ? copies.filter((copy) => input.copyIds!.includes(copy.id))
            : copies;
          const allowedProjectIds: string[] = [];
          for (const copy of copiesToPush) {
            const hasPermission = await ctx.can("evaluations:manage", {
              projectId: copy.projectId,
            });
            if (hasPermission) allowedProjectIds.push(copy.projectId);
          }
          return ctx.app.evaluators.pushToCopies({ ...input, allowedProjectIds });
        },
      ),

      /** Sync a copied evaluator from its source. */
      syncFromSource: policy("evaluations:manage")(procedure.input(evaluatorScopeSchema)).mutation(
        async ({ ctx, input }) => {
          const { source } = await ctx.app.evaluators.getCopySource(input);

          const hasSourcePermission = await ctx.can("evaluations:manage", {
            projectId: source.projectId,
          });
          if (!hasSourcePermission) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You do not have permission to read from the source evaluator's project",
            });
          }

          return ctx.app.evaluators.syncFromSource(input);
        },
      ),

      /**
       * Returns recent audit log history for a specific evaluator.
       * Used by the "View History" drawer on the evaluators page.
       */
      getHistory: policy("evaluations:view")(procedure.input(historyInputSchema)).query(
        async ({ ctx, input }) => {
          return ctx.app.evaluators.getHistory({
            evaluatorId: input.evaluatorId,
            projectId: input.projectId,
          });
        },
      ),
    });
  }
}

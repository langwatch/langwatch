/**
 * The optimization studio's workflow surface over a host's tRPC transport. chat: runs the
 * published workflow once with a chat message, the way the studio's chat panel does.
 * Spec: packages/features/workflow/specs/workflow-service.feature.
 */
import { createTrpcService, type TrpcPolicyDecorator } from "@langwatch/api/trpc";
import type { AuthzDeclaration, AuthzPermission } from "@langwatch/authz-contract";
import { workflowWriteAcknowledgedSchema } from "@langwatch/workflow-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import type { WorkflowApp } from "#app/workflow.app";

/**
 * The host supplies authentication; authorization arrives as `policy`.
 */
export type WorkflowOptimizationTrpcContext = Readonly<{
  app: Readonly<{ workflows: WorkflowApp }>;
}>;

type WorkflowOptimizationTrpcProcedures<
  TContext extends WorkflowOptimizationTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The host's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The host's tracing, logging, error, scope-lineage, authorization and audit policy for one
   * declared permission.
   */
  policy(access: AuthzPermission | AuthzDeclaration): TrpcPolicyDecorator;
  /** @see the mount field of the same name. */
  validateOutput: boolean;
}>;

/** The workflow row this surface reads and flips flags on. */
type OptimizationWorkflow = Readonly<{
  id: string;
  name: string;
  publishedId: string | null;
  isComponent: boolean;
  isEvaluator: boolean;
}>;

/**
 * The host capabilities this transport needs. `TVersion` and `TComponent` are inferred from the
 * host's own reads, so the rows reach the studio with the shape they have always had rather
 * than a narrowed copy of it.
 */
export type WorkflowOptimizationTrpcPorts<TVersion, TComponent> = Readonly<{
  /**
   * Runs the project's published workflow once, on the same service the public
   * run endpoint dispatches through, under the scope this procedure checked.
   */
  runPublishedWorkflow(
    ctx: WorkflowOptimizationTrpcContext,
    input: Readonly<{
      workflowId: string;
      projectId: string;
      body: Readonly<Record<string, unknown>>;
    }>,
  ): Promise<unknown>;
  /** One workflow by id within a project, or null. */
  tryGetWorkflow(
    ctx: WorkflowOptimizationTrpcContext,
    input: Readonly<{ workflowId: string; projectId: string }>,
  ): Promise<OptimizationWorkflow | null>;
  /** One workflow version by id within a project, or null. */
  tryGetWorkflowVersion(
    ctx: WorkflowOptimizationTrpcContext,
    input: Readonly<{ versionId: string; projectId: string }>,
  ): Promise<TVersion | null>;
  /**
   * Writes the component/evaluator flags. A host port because they are not on
   * `UpdateWorkflowCommand`: they are the studio's own publication state.
   */
  setWorkflowFlags(
    ctx: WorkflowOptimizationTrpcContext,
    input: Readonly<{
      workflowId: string;
      projectId: string;
      isComponent?: boolean;
      isEvaluator?: boolean;
    }>,
  ): Promise<void>;
  /**
   * Every workflow published as a component or an evaluator, each carrying only
   * its published version.
   */
  listPublishedComponents(
    ctx: WorkflowOptimizationTrpcContext,
    input: Readonly<{ projectId: string }>,
  ): Promise<TComponent[]>;
}>;

const workflowScopeSchema = z.object({ workflowId: z.string(), projectId: z.string() });

/**
 * Installs the complete `optimization.*` tRPC surface on a host-owned root. The
 * procedure and the policy are injected by the host so its auth, audit, error,
 * logging and tracing policies wrap every feature procedure consistently.
 */
export class WorkflowOptimizationTrpcApi {
  static create<
    TContext extends WorkflowOptimizationTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
    TVersion,
    TComponent,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: WorkflowOptimizationTrpcProcedures<TContext, TOptions, TRoot>,
    ports: WorkflowOptimizationTrpcPorts<TVersion, TComponent>,
  ) {
    const { protected: procedure, policy } = procedures;

    return (
      createTrpcService({
        root: trpc,
        procedures: { protected: procedure, policy },
        validateOutput: procedures.validateOutput,
      })
        /**
         * Running a published workflow spends model budget and executes the
         * graph's code and HTTP nodes, so it is gated on the same permission the
         * public run endpoint declares — not on the permission to look at it.
         */
        .mutation("chat", (p) =>
          p
            .withInput(
              workflowScopeSchema.extend({
                inputMessages: z.array(z.record(z.string(), z.string())),
              }),
            )
            .withoutOutput(
              "the run's answer is the process's own engine response, generic in this feature: naming one here would narrow what the studio is handed",
            )
            .withPermission("workflows:manage")
            .handle(
              async ({ ctx, input }) =>
                await ports.runPublishedWorkflow(ctx, {
                  workflowId: input.workflowId,
                  projectId: input.projectId,
                  body: input.inputMessages[0] ?? {},
                }),
            ),
        )

        /**
         * Null when nothing is published yet, which is a state the studio renders
         * rather than an error: a workflow becomes a component before it has a
         * published version.
         */
        .query("getPublishedWorkflow", (p) =>
          p
            .withInput(workflowScopeSchema)
            .withoutOutput(
              "a published version's shape is the process's own read, generic in this feature: naming one here would narrow what the studio is handed",
            )
            .withPermission("workflows:view")
            .handle(async ({ ctx, input }) => {
              const workflow = await ports.tryGetWorkflow(ctx, {
                workflowId: input.workflowId,
                projectId: input.projectId,
              });
              const publishedWorkflow = await ports.tryGetWorkflowVersion(ctx, {
                versionId: workflow?.publishedId ?? "",
                projectId: input.projectId,
              });

              if (!publishedWorkflow) {
                return null;
              }

              return {
                ...publishedWorkflow,
                isComponent: workflow?.isComponent,
                isEvaluator: workflow?.isEvaluator,
              };
            }),
        )
        .mutation("disableAsComponent", (p) =>
          p
            .withInput(workflowScopeSchema)
            .withOutput(workflowWriteAcknowledgedSchema)
            .withPermission("workflows:update")
            .handle(async ({ ctx, input }) => {
              await ports.setWorkflowFlags(ctx, {
                workflowId: input.workflowId,
                projectId: input.projectId,
                isComponent: false,
              });

              return { success: true };
            }),
        )

        /**
         * Archives the evaluator this workflow was published as, so nothing keeps
         * an evaluator pointing at a workflow that no longer offers itself.
         */
        .mutation("disableAsEvaluator", (p) =>
          p
            .withInput(workflowScopeSchema)
            .withOutput(workflowWriteAcknowledgedSchema)
            .withPermission("workflows:update")
            .handle(async ({ ctx, input }) => {
              const { workflowId, projectId } = input;

              await ports.setWorkflowFlags(ctx, { workflowId, projectId, isEvaluator: false });

              await ctx.app.workflows.unlinkEvaluatorFromWorkflow({ workflowId, projectId });

              return { success: true };
            }),
        )

        /** A workflow is a component or an evaluator, never both. */
        .mutation("toggleSaveAsComponent", (p) =>
          p
            .withInput(
              workflowScopeSchema.extend({
                isComponent: z.boolean(),
                isEvaluator: z.boolean(),
              }),
            )
            .withOutput(workflowWriteAcknowledgedSchema)
            .withPermission("workflows:update")
            .handle(async ({ ctx, input }) => {
              const { workflowId, projectId, isComponent } = input;
              const isEvaluator = isComponent ? false : input.isEvaluator;

              await ports.setWorkflowFlags(ctx, {
                workflowId,
                projectId,
                isComponent,
                isEvaluator,
              });
              return { success: true };
            }),
        )

        /**
         * Publishing as an evaluator creates the evaluator that wraps the
         * workflow, or renames an existing one to match — so the evaluator picker
         * never shows a stale name for a workflow that was renamed.
         */
        .mutation("toggleSaveAsEvaluator", (p) =>
          p
            .withInput(
              workflowScopeSchema.extend({
                isEvaluator: z.boolean(),
                isComponent: z.boolean(),
              }),
            )
            .withOutput(workflowWriteAcknowledgedSchema)
            .withPermission("workflows:update")
            .handle(async ({ ctx, input }) => {
              const { workflowId, projectId, isEvaluator } = input;

              const workflow = await ports.tryGetWorkflow(ctx, { workflowId, projectId });

              if (!workflow) {
                throw new Error("Workflow not found");
              }

              await ports.setWorkflowFlags(ctx, {
                workflowId,
                projectId,
                isEvaluator,
                isComponent: !isEvaluator,
              });

              if (isEvaluator) {
                await ctx.app.workflows.linkEvaluatorToWorkflow({
                  workflowId,
                  projectId,
                  name: workflow.name,
                });
              }

              return { success: true };
            }),
        )
        .query("getComponents", (p) =>
          p
            .withInput(z.object({ projectId: z.string() }))
            .withoutOutput(
              "a published component's shape is the process's own read, generic in this feature: naming one here would narrow what the studio is handed",
            )
            .withPermission("workflows:view")
            .handle(
              async ({ ctx, input }) =>
                await ports.listPublishedComponents(ctx, { projectId: input.projectId }),
            ),
        )
        .build()
    );
  }
}

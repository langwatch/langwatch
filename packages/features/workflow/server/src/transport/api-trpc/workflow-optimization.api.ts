/**
 * The optimization studio's workflow surface over a host's tRPC transport.
 *
 *   chat:                   runs the published workflow once with a chat
 *                           message, the way the studio's chat panel does.
 *   getPublishedWorkflow:   the published version a component or evaluator
 *                           resolves to, plus the two flags that say which it
 *                           is.
 *   getComponents:          every workflow the project has published as a
 *                           reusable component or as an evaluator.
 *   toggleSaveAsComponent / toggleSaveAsEvaluator: publishing a workflow as one
 *                           or the other — they are mutually exclusive, and
 *                           saving as an evaluator creates or renames the
 *                           evaluator that wraps it.
 *   disableAsComponent / disableAsEvaluator: withdrawing it again; withdrawing
 *                           an evaluator archives the evaluator it created,
 *                           so nothing keeps pointing at a workflow that no
 *                           longer offers itself.
 *
 * Reading takes `workflows:view`; every flag change takes `workflows:update`.
 *
 * Mounted at `optimization.*` rather than `workflows.*`: these procedures are
 * the optimization studio's, and the name is the one its pages have always
 * called.
 *
 * Transport only: policy and delegation. The workflow rows behind the two
 * component flags are still written through host ports, because the flags are
 * not on `UpdateWorkflowCommand` yet.
 *
 * Spec: packages/features/workflow/specs/workflow-service.feature.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import type { WorkflowApp } from "#app/workflow.app";

/**
 * The host supplies authentication; authorization arrives as `policy`.
 *
 * The same slice `workflow.*` takes, and the same {@link WorkflowApp} object:
 * this surface used to declare a bag of its own holding only the evaluator
 * service, which is why the rule linking an evaluator to a workflow could not
 * be shared with the door that reads those evaluators back.
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
   * The host's tracing, logging, error, scope-lineage, authorization and audit
   * policy for one declared permission.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
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
 * The host capabilities this transport needs.
 *
 * `TVersion` and `TComponent` are inferred from the host's own reads, so the
 * rows reach the studio with the shape they have always had rather than a
 * narrowed copy of it.
 */
export type WorkflowOptimizationTrpcPorts<TVersion, TComponent> = Readonly<{
  /**
   * Runs the project's published workflow once, over the same public run
   * endpoint an external caller would use, authenticated as the project.
   */
  runPublishedWorkflow(
    ctx: WorkflowOptimizationTrpcContext,
    input: Readonly<{ workflowId: string; projectId: string; body: unknown }>,
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

    return trpc.router({
      chat: policy("workflows:view")(
        procedure.input(
          workflowScopeSchema.extend({
            inputMessages: z.array(z.record(z.string(), z.string())),
          }),
        ),
      ).mutation(
        async ({ ctx, input }) =>
          await ports.runPublishedWorkflow(ctx, {
            workflowId: input.workflowId,
            projectId: input.projectId,
            body: input.inputMessages[0],
          }),
      ),

      /**
       * Null when nothing is published yet, which is a state the studio renders
       * rather than an error: a workflow becomes a component before it has a
       * published version.
       */
      getPublishedWorkflow: policy("workflows:view")(procedure.input(workflowScopeSchema)).query(
        async ({ ctx, input }) => {
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
        },
      ),

      disableAsComponent: policy("workflows:update")(procedure.input(workflowScopeSchema)).mutation(
        async ({ ctx, input }) => {
          await ports.setWorkflowFlags(ctx, {
            workflowId: input.workflowId,
            projectId: input.projectId,
            isComponent: false,
          });

          return { success: true };
        },
      ),

      /**
       * Archives the evaluator this workflow was published as, so nothing keeps
       * an evaluator pointing at a workflow that no longer offers itself.
       */
      disableAsEvaluator: policy("workflows:update")(procedure.input(workflowScopeSchema)).mutation(
        async ({ ctx, input }) => {
          const { workflowId, projectId } = input;

          await ports.setWorkflowFlags(ctx, { workflowId, projectId, isEvaluator: false });

          await ctx.app.workflows.unlinkEvaluatorFromWorkflow({ workflowId, projectId });

          return { success: true };
        },
      ),

      /** A workflow is a component or an evaluator, never both. */
      toggleSaveAsComponent: policy("workflows:update")(
        procedure.input(
          workflowScopeSchema.extend({
            isComponent: z.boolean(),
            isEvaluator: z.boolean(),
          }),
        ),
      ).mutation(async ({ ctx, input }) => {
        const { workflowId, projectId, isComponent } = input;
        const isEvaluator = isComponent ? false : input.isEvaluator;

        await ports.setWorkflowFlags(ctx, { workflowId, projectId, isComponent, isEvaluator });
        return { success: true };
      }),

      /**
       * Publishing as an evaluator creates the evaluator that wraps the
       * workflow, or renames an existing one to match — so the evaluator picker
       * never shows a stale name for a workflow that was renamed.
       */
      toggleSaveAsEvaluator: policy("workflows:update")(
        procedure.input(
          workflowScopeSchema.extend({
            isEvaluator: z.boolean(),
            isComponent: z.boolean(),
          }),
        ),
      ).mutation(async ({ ctx, input }) => {
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

      getComponents: policy("workflows:view")(
        procedure.input(z.object({ projectId: z.string() })),
      ).query(
        async ({ ctx, input }) =>
          await ports.listPublishedComponents(ctx, { projectId: input.projectId }),
      ),
    });
  }
}

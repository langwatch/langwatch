/**
 * The server half of `optimization.*`: the Optimization Studio's own surface
 * over the workflow module's application.
 * Spec: modules/workflow/specs/workflow-service.feature.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { WorkflowApi, workflowOptimizationTrpc } from "@langwatch/workflow-contract";

export const workflowOptimizationTrpcTransport = defineTrpcRouter(
  WorkflowApi,
  workflowOptimizationTrpc,
)
  /**
   * Running a published workflow spends model budget and executes the graph's
   * code and HTTP nodes, so it is gated on the same permission the public run
   * endpoint declares - not on the permission to look at it.
   */
  .procedure("chat")
  .withPermission("workflows:manage")
  .handle(({ app, input }) =>
    app.runPublished({
      workflowId: input.workflowId,
      projectId: input.projectId,
      body: input.inputMessages[0] ?? {},
    }),
  )

  /**
   * Null when nothing is published yet, which is a state the studio renders
   * rather than an error: a workflow becomes a component before it has a
   * published version.
   */
  .procedure("getPublishedWorkflow")
  .withPermission("workflows:view")
  .handle(async ({ app, input }) => {
    const answer = await app.getPublishedWorkflow(input);
    return answer.published ? answer.workflow : null;
  })

  .procedure("disableAsComponent")
  .withPermission("workflows:update")
  .handle(async ({ app, input }) => {
    await app.setWorkflowFlags({ ...input, isComponent: false });

    return { success: true };
  })

  /**
   * Archives the evaluator this workflow was published as, so nothing keeps an
   * evaluator pointing at a workflow that no longer offers itself.
   */
  .procedure("disableAsEvaluator")
  .withPermission("workflows:update")
  .handle(async ({ app, input }) => {
    await app.setWorkflowFlags({ ...input, isEvaluator: false });
    await app.unlinkEvaluatorFromWorkflow(input);

    return { success: true };
  })

  /** A workflow is a component or an evaluator, never both. */
  .procedure("toggleSaveAsComponent")
  .withPermission("workflows:update")
  .handle(async ({ app, input }) => {
    const { workflowId, projectId, isComponent } = input;

    await app.setWorkflowFlags({
      workflowId,
      projectId,
      isComponent,
      isEvaluator: isComponent ? false : input.isEvaluator,
    });

    return { success: true };
  })

  /**
   * Publishing as an evaluator creates the evaluator that wraps the workflow,
   * or renames an existing one to match - so the evaluator picker never shows
   * a stale name for a workflow that was renamed.
   */
  .procedure("toggleSaveAsEvaluator")
  .withPermission("workflows:update")
  .handle(async ({ app, input }) => {
    await app.toggleSaveAsEvaluator(input);

    return { success: true };
  })

  .procedure("getComponents")
  .withPermission("workflows:view")
  .handle(({ app, input }) => app.listPublishedComponents({ projectId: input.projectId }))
  .build();

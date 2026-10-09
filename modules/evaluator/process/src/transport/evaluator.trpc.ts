/**
 * The server half of `evaluators.*`: a permission and a handler per procedure
 * the contract already named. Names, kinds and schemas are not repeated here.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { evaluatorTrpc, type EvaluatorApi } from "@langwatch/evaluator-contract";
import { moduleApi } from "@langwatch/module";

/** What the evaluator browser door reaches: the evaluator application, and the studio switch. */
export interface EvaluatorBrowserApi {
  /** This module's own application, as the process composed it. */
  evaluators(): EvaluatorApi;
  /** Publishes a workflow as an evaluator, creating or renaming the evaluator that wraps it. */
  toggleSaveAsEvaluator(input: {
    workflowId: string;
    projectId: string;
    isEvaluator: boolean;
  }): Promise<void>;
  /** Clears a workflow's evaluator flag and archives the evaluator that wrapped it. */
  disableAsEvaluator(input: { workflowId: string; projectId: string }): Promise<void>;
}

export const EvaluatorBrowserApi = moduleApi<EvaluatorBrowserApi>()("evaluator");

export const evaluatorTrpcTransport: TrpcRouterDeclaration<
  EvaluatorBrowserApi,
  typeof evaluatorTrpc
> = defineTrpcRouter(EvaluatorBrowserApi, evaluatorTrpc)
  .procedure("getAll")
  .withPermission("evaluations:view")
  .handle(async ({ app, input }) =>
    app.evaluators().getAllWithFields({ projectId: input.projectId }),
  )

  // Both reads answer `null` on the wire, which is what the drawer opens on
  // when the project no longer has the evaluator the URL names.
  .procedure("getById")
  .withPermission("evaluations:view")
  .handle(
    async ({ app, input }) =>
      (await app.evaluators().findByIdWithFields({ id: input.id, projectId: input.projectId })) ??
      null,
  )

  .procedure("getBySlug")
  .withPermission("evaluations:view")
  .handle(
    async ({ app, input }) =>
      (await app.evaluators().findBySlug({ slug: input.slug, projectId: input.projectId })) ?? null,
  )

  .procedure("create")
  .withPermission("evaluations:manage")
  .handle(async ({ app, input }) =>
    app.evaluators().create({
      id: input.id,
      projectId: input.projectId,
      name: input.name,
      type: input.type,
      config: input.config,
      ...(input.workflowId !== void 0 && { workflowId: input.workflowId }),
    }),
  )

  .procedure("update")
  .withPermission("evaluations:manage")
  .handle(async ({ app, input }) =>
    app.evaluators().update({
      id: input.id,
      projectId: input.projectId,
      data: {
        ...(input.name !== void 0 && { name: input.name }),
        ...(input.type !== void 0 && { type: input.type }),
        ...(input.config !== void 0 && { config: input.config }),
        ...(input.workflowId !== void 0 && { workflowId: input.workflowId }),
      },
    }),
  )

  .procedure("getRelatedEntities")
  .withPermission("evaluations:view")
  .handle(async ({ app, input }) =>
    app.evaluators().getRelatedEntities({ id: input.id, projectId: input.projectId }),
  )

  // Asked at the workflow's grain: whoever may archive a workflow sees what goes with it.
  .procedure("listByWorkflow")
  .withPermission("workflows:view")
  .handle(async ({ app, input }) =>
    (
      await app
        .evaluators()
        .listByWorkflow({ workflowId: input.workflowId, projectId: input.projectId })
    ).map(({ id, name }) => ({ id, name })),
  )

  .procedure("cascadeArchive")
  .withPermission("evaluations:manage")
  .handle(async ({ app, input }) =>
    app.evaluators().cascadeArchive({ id: input.id, projectId: input.projectId }),
  )

  .procedure("delete")
  .withPermission("evaluations:manage")
  .handle(async ({ app, input }) =>
    app.evaluators().archive({ id: input.id, projectId: input.projectId }),
  )

  .procedure("getWorkflowFields")
  .withPermission("evaluations:view")
  .handle(async ({ app, input }) =>
    app.evaluators().getWorkflowFields({ id: input.id, projectId: input.projectId }),
  )

  .procedure("getCopies")
  .withPermission("evaluations:view")
  .handle(async ({ app, actor, input }) =>
    app.evaluators().getCopies({
      evaluatorId: input.evaluatorId,
      projectId: input.projectId,
      actorId: actor.id,
    }),
  )

  .procedure("copy")
  .withPermission("evaluations:manage")
  .handle(async ({ app, actor, input }) =>
    app.evaluators().copy({
      evaluatorId: input.evaluatorId,
      projectId: input.projectId,
      sourceProjectId: input.sourceProjectId,
      newEvaluatorId: input.newEvaluatorId,
      actorId: actor.id,
    }),
  )

  .procedure("pushToCopies")
  .withPermission("evaluations:manage")
  .handle(async ({ app, actor, input }) =>
    app.evaluators().pushToCopies({
      projectId: input.projectId,
      evaluatorId: input.evaluatorId,
      ...(input.copyIds !== void 0 && { copyIds: input.copyIds }),
      actorId: actor.id,
    }),
  )

  .procedure("syncFromSource")
  .withPermission("evaluations:manage")
  .handle(async ({ app, actor, input }) =>
    app.evaluators().syncFromSource({
      projectId: input.projectId,
      evaluatorId: input.evaluatorId,
      actorId: actor.id,
    }),
  )

  .procedure("getHistory")
  .withPermission("evaluations:view")
  .handle(async ({ app, input }) =>
    app.evaluators().getHistory({ evaluatorId: input.evaluatorId, projectId: input.projectId }),
  )

  /** Moved from `optimization.*` with its input, answer and permission (round 26, CD-2). */
  .procedure("disableAsEvaluator")
  .withPermission("workflows:update")
  .handle(async ({ app, input }) => {
    await app.disableAsEvaluator(input);

    return { success: true };
  })

  /** A workflow is an evaluator or a component, never both; the switch sets both flags. */
  .procedure("toggleSaveAsEvaluator")
  .withPermission("workflows:update")
  .handle(async ({ app, input }) => {
    await app.toggleSaveAsEvaluator(input);

    return { success: true };
  })
  .build();

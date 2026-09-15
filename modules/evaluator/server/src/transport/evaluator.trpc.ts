/**
 * The server half of `evaluators.*`: a permission and a handler per procedure
 * the contract already named. Names, kinds and schemas are not repeated here.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { EvaluatorApi, evaluatorTrpc } from "@langwatch/evaluator-contract";

export const evaluatorTrpcTransport = defineTrpcRouter(EvaluatorApi, evaluatorTrpc)
  .procedure("getAll")
  .withPermission("evaluations:view")
  .handle(async ({ app, input }) => app.getAllWithFields({ projectId: input.projectId }))

  // Both reads answer `null` on the wire, which is what the drawer opens on
  // when the project no longer has the evaluator the URL names.
  .procedure("getById")
  .withPermission("evaluations:view")
  .handle(
    async ({ app, input }) =>
      (await app.findByIdWithFields({ id: input.id, projectId: input.projectId })) ?? null,
  )

  .procedure("getBySlug")
  .withPermission("evaluations:view")
  .handle(
    async ({ app, input }) =>
      (await app.findBySlug({ slug: input.slug, projectId: input.projectId })) ?? null,
  )

  .procedure("create")
  .withPermission("evaluations:manage")
  .handle(async ({ app, input }) =>
    app.create({
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
    app.update({
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
    app.getRelatedEntities({ id: input.id, projectId: input.projectId }),
  )

  .procedure("cascadeArchive")
  .withPermission("evaluations:manage")
  .handle(async ({ app, input }) =>
    app.cascadeArchive({ id: input.id, projectId: input.projectId }),
  )

  .procedure("delete")
  .withPermission("evaluations:manage")
  .handle(async ({ app, input }) => app.archive({ id: input.id, projectId: input.projectId }))

  .procedure("getWorkflowFields")
  .withPermission("evaluations:view")
  .handle(async ({ app, input }) =>
    app.getWorkflowFields({ id: input.id, projectId: input.projectId }),
  )

  .procedure("getCopies")
  .withPermission("evaluations:view")
  .handle(async ({ app, actor, input }) =>
    app.getCopies({
      evaluatorId: input.evaluatorId,
      projectId: input.projectId,
      actorId: actor.id,
    }),
  )

  .procedure("copy")
  .withPermission("evaluations:manage")
  .handle(async ({ app, actor, input }) =>
    app.copy({
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
    app.pushToCopies({
      projectId: input.projectId,
      evaluatorId: input.evaluatorId,
      ...(input.copyIds !== void 0 && { copyIds: input.copyIds }),
      actorId: actor.id,
    }),
  )

  .procedure("syncFromSource")
  .withPermission("evaluations:manage")
  .handle(async ({ app, actor, input }) =>
    app.syncFromSource({
      projectId: input.projectId,
      evaluatorId: input.evaluatorId,
      actorId: actor.id,
    }),
  )

  .procedure("getHistory")
  .withPermission("evaluations:view")
  .handle(async ({ app, input }) =>
    app.getHistory({ evaluatorId: input.evaluatorId, projectId: input.projectId }),
  )
  .build();

/**
 * The server half of the saved-workbench-chart namespace: a permission and a
 * handler per procedure. The member is the viewer: charts on boards they cannot
 * see read as not found. The app applies the rollout gate and protections.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { DashboardApi, savedWorkbenchChartTrpc } from "@langwatch/dashboard-contract";

export const savedWorkbenchChartTrpcTransport: TrpcRouterDeclaration<
  DashboardApi,
  typeof savedWorkbenchChartTrpc
> = defineTrpcRouter(DashboardApi, savedWorkbenchChartTrpc)
  .procedure("getAll")
  .withPermission("analytics:view")
  .handle(async ({ app, input, actor }) =>
    app.listSavedWorkbenchCharts({ projectId: input.projectId, viewer: { userId: actor.id } }),
  )

  .procedure("getById")
  .withPermission("analytics:view")
  .handle(async ({ app, input, actor }) =>
    app.getSavedWorkbenchChart({
      projectId: input.projectId,
      chartId: input.id,
      viewer: { userId: actor.id },
    }),
  )

  .procedure("create")
  .withPermission("analytics:create")
  .handle(async ({ app, input, actor }) =>
    app.createMemberSavedWorkbenchChart({
      projectId: input.projectId,
      actorId: actor.id,
      name: input.name,
      definition: input.definition,
    }),
  )

  .procedure("update")
  .withPermission("analytics:update")
  .handle(async ({ app, input, actor }) =>
    app.updateMemberSavedWorkbenchChart({
      projectId: input.projectId,
      actorId: actor.id,
      chartId: input.id,
      viewer: { userId: actor.id },
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.definition === undefined ? {} : { definition: input.definition }),
    }),
  )

  .procedure("run")
  .withPermission("analytics:view")
  .handle(async ({ app, input, actor }) =>
    app.runSavedWorkbenchChart({
      projectId: input.projectId,
      chartId: input.id,
      actorId: actor.id,
      viewer: { userId: actor.id },
      ...(input.timeWindow === undefined ? {} : { timeWindow: input.timeWindow }),
      ...(input.granularitySeconds === undefined
        ? {}
        : { granularitySeconds: input.granularitySeconds }),
      ...(input.onBudgetOverflow === undefined ? {} : { onBudgetOverflow: input.onBudgetOverflow }),
    }),
  )

  .procedure("delete")
  .withPermission("analytics:delete")
  .handle(async ({ app, input, actor }) => {
    await app.deleteSavedWorkbenchChart({
      projectId: input.projectId,
      chartId: input.id,
      viewer: { userId: actor.id },
    });

    return { success: true as const };
  })
  .build();

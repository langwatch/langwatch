/**
 * The server half of the saved-workbench-chart namespace: a permission and a
 * handler per procedure the contract already named. Thin by design — the
 * application resolves who is asking, applies the rollout gate and admits the
 * definition against that member's own protections.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { DashboardApi, savedWorkbenchChartTrpc } from "@langwatch/dashboard-contract";

export const savedWorkbenchChartTrpcTransport = defineTrpcRouter(
  DashboardApi,
  savedWorkbenchChartTrpc,
)
  .procedure("getAll")
  .withPermission("analytics:view")
  .handle(async ({ app, input }) => app.listSavedWorkbenchCharts({ projectId: input.projectId }))

  .procedure("getById")
  .withPermission("analytics:view")
  .handle(async ({ app, input }) =>
    app.getSavedWorkbenchChart({ projectId: input.projectId, chartId: input.id }),
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
      ...(input.timeWindow === undefined ? {} : { timeWindow: input.timeWindow }),
      ...(input.granularitySeconds === undefined
        ? {}
        : { granularitySeconds: input.granularitySeconds }),
      ...(input.onBudgetOverflow === undefined ? {} : { onBudgetOverflow: input.onBudgetOverflow }),
    }),
  )

  .procedure("delete")
  .withPermission("analytics:delete")
  .handle(async ({ app, input }) => {
    await app.deleteSavedWorkbenchChart({ projectId: input.projectId, chartId: input.id });

    return { success: true as const };
  })
  .build();

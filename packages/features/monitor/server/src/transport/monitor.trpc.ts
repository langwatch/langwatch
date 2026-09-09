/**
 * The server half of `monitors.*`: a permission and a handler per procedure.
 *
 * What a monitor is, whether its check can run, what a partial update means and
 * what copying one does to two projects are all the application's. This decides
 * only which standing the caller needs.
 *
 * Specs: specs/monitors/replicate-monitor-to-project.feature,
 * specs/monitors/online-evaluation-preconditions.feature.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { MonitorApi, monitorTrpc } from "@langwatch/monitor-contract";

export const monitorTrpcTransport = defineTrpcRouter(MonitorApi, monitorTrpc)
  .procedure("getAllForProject")
  .withPermission("evaluations:view")
  .handle(({ app, input }) => app.list({ projectId: input.projectId }))

  /**
   * `evaluations:view` for the monitors, and `analytics:view` on top because
   * the trend is the analytics page's own comparison window.
   */
  .procedure("getPerformanceForProject")
  .withPermission(["evaluations:view", "analytics:view"])
  .handle(({ app, input, actor }) =>
    app.performanceForProject({
      projectId: input.projectId,
      ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
      actor: { id: actor.id },
    }),
  )

  .procedure("getById")
  .withPermission("evaluations:view")
  .handle(({ app, input }) => app.getById(input))

  .procedure("isNameAvailable")
  .withPermission("evaluations:view")
  .handle(({ app, input }) => app.isNameAvailable(input))

  .procedure("create")
  .withPermission("evaluations:create")
  .handle(async ({ app, input }) => {
    const { settings: parameters, ...rest } = input;
    await app.assertCheckRunnable({ checkType: input.checkType, parameters });

    return app.create({ ...rest, parameters });
  })

  .procedure("update")
  .withPermission("evaluations:update")
  .handle(async ({ app, input }) => {
    const { settings: parameters, ...rest } = input;
    await app.assertCheckRunnable({ checkType: input.checkType, parameters });

    return app.update({ ...rest, parameters });
  })

  .procedure("toggle")
  .withPermission("evaluations:update")
  .handle(({ app, input }) => app.toggle(input))

  .procedure("delete")
  .withPermission("evaluations:delete")
  .handle(({ app, input }) => app.delete(input))

  // The declared check covers the project being copied INTO; standing in the
  // project copied FROM is the application's second question.
  .procedure("copy")
  .withPermission("evaluations:manage")
  .handle(({ app, input, actor }) =>
    app.copy({
      monitorId: input.monitorId,
      sourceProjectId: input.sourceProjectId,
      targetProjectId: input.projectId,
      actor: { id: actor.id },
    }),
  )
  .build();

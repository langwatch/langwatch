/**
 * The server half of monitors.*: permissions and handlers per procedure.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { MonitorApi, monitorTrpc } from "@langwatch/monitor-contract";

export const monitorTrpcTransport: TrpcRouterDeclaration<MonitorApi, typeof monitorTrpc> =
  defineTrpcRouter(MonitorApi, monitorTrpc)
    .procedure("getAllForProject")
    .withPermission("evaluations:view")
    .handle(({ app, input }) => app.list({ projectId: input.projectId }))

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

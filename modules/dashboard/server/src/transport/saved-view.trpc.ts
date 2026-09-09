/**
 * The server half of `savedViews.*`: a permission and a handler per procedure
 * the contract already named.
 *
 * Every procedure takes `traces:view`: a saved view is a stored trace filter,
 * so being able to read traces is exactly the right to keep one.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { DashboardApi, savedViewTrpc } from "@langwatch/dashboard-contract";

export const savedViewTrpcTransport = defineTrpcRouter(DashboardApi, savedViewTrpc)
  .procedure("getAll")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) =>
    app.listSavedViews({
      projectId: input.projectId,
      actorId: actor.id,
      ...(input.kind === undefined ? {} : { kind: input.kind }),
    }),
  )

  .procedure("create")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) =>
    app.createSavedView({
      projectId: input.projectId,
      actorId: actor.id,
      ...(input.id === undefined ? {} : { id: input.id }),
      name: input.name,
      filters: input.filters,
      ...(input.query === undefined ? {} : { query: input.query }),
      ...(input.period === undefined ? {} : { period: input.period }),
      personal: input.scope === "myself",
      ...(input.kind === undefined ? {} : { kind: input.kind }),
    }),
  )

  .procedure("delete")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) =>
    app.deleteSavedView({
      projectId: input.projectId,
      actorId: actor.id,
      viewId: input.viewId,
    }),
  )

  .procedure("rename")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) =>
    app.renameSavedView({
      projectId: input.projectId,
      actorId: actor.id,
      viewId: input.viewId,
      name: input.name,
    }),
  )

  .procedure("reorder")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) =>
    app.reorderSavedViews({
      projectId: input.projectId,
      actorId: actor.id,
      viewIds: input.viewIds,
    }),
  )
  .build();

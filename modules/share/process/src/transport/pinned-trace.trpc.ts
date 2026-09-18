/**
 * The server half of `pinnedTrace.*`. Unpinning is the one operation share
 * owns: an active share link holds its trace pinned, and dropping that pin out
 * from under a live link would break the link, so the app refuses it.
 */

import { defineTrpcRouter } from "@langwatch/api/trpc";
import { pinnedTraceTrpc, ShareApi } from "@langwatch/share-contract";

export const pinnedTraceTrpcTransport = defineTrpcRouter(ShareApi, pinnedTraceTrpc)
  .procedure("pin")
  .withPermission("project:update")
  .handle(async ({ app, input, actor }) =>
    app.pinTrace({
      projectId: input.projectId,
      traceId: input.traceId,
      userId: actor.id,
      reason: input.reason,
    }),
  )

  .procedure("unpin")
  .withPermission("project:update")
  .handle(async ({ app, input }) =>
    app.unpinTrace({ projectId: input.projectId, traceId: input.traceId }),
  )

  .procedure("getPin")
  .withPermission("traces:view")
  .handle(async ({ app, input }) =>
    app.findTracePin({ projectId: input.projectId, traceId: input.traceId }),
  )

  .procedure("listByProject")
  .withPermission("traces:view")
  .handle(async ({ app, input }) => app.listTracePins({ projectId: input.projectId }))
  .build();

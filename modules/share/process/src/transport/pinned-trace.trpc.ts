/**
 * The server half of `pinnedTrace.*`. Unpinning is the one operation share
 * owns: an active share link holds its trace pinned, and dropping that pin out
 * from under a live link would break the link, so the app refuses it.
 */

import { defineTrpcRouter } from "@langwatch/api/trpc";
import { PinnedToActiveShareError, pinnedTraceTrpc, ShareApi } from "@langwatch/share-contract";
import { TRPCError } from "@trpc/server";

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
  .handle(async ({ app, input }) => {
    try {
      await app.unpinTrace({ projectId: input.projectId, traceId: input.traceId });
    } catch (error) {
      // Surfaces as a non-toast inline error in the UI (the PinButton also
      // disables itself when source=share and the share is active, but the
      // client is never trusted; this is the gate).
      if (error instanceof PinnedToActiveShareError) {
        throw new TRPCError({ code: "CONFLICT", message: error.message });
      }
      throw error;
    }
  })

  .procedure("getPin")
  .withPermission("traces:view")
  .handle(async ({ app, input }) =>
    app.findTracePin({ projectId: input.projectId, traceId: input.traceId }),
  )

  .procedure("listByProject")
  .withPermission("traces:view")
  .handle(async ({ app, input }) => app.listTracePins({ projectId: input.projectId }))
  .build();

/**
 * The server half of `traceEditOverlay.*`. Reading needs `traces:view`,
 * writing `annotations:update`. Transport only: the viewer's redactions
 * are the app's.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { TraceApi, traceEditOverlayTrpc } from "@langwatch/trace-contract";

export const traceEditOverlayTrpcTransport = defineTrpcRouter(TraceApi, traceEditOverlayTrpc)
  .procedure("getByTraceId")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) => {
    const { overlay } = await app.readTraceEditOverlayForViewer({
      projectId: input.projectId,
      traceId: input.traceId,
      viewerUserId: actor.id,
    });
    return overlay;
  })

  .procedure("upsert")
  .withPermission("annotations:update")
  .handle(({ app, input, actor }) =>
    app.saveTraceEditOverlayAsViewer({
      projectId: input.projectId,
      traceId: input.traceId,
      patch: input.patch,
      viewerUserId: actor.id,
    }),
  )

  .procedure("delete")
  .withPermission("annotations:update")
  .handle(async ({ app, input }) => {
    await app.deleteTraceEditOverlay({ projectId: input.projectId, traceId: input.traceId });
  })
  .build();

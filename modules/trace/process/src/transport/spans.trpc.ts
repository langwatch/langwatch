/**
 * The server half of `spans.*`. Both procedures take `traces:view` — a
 * span is trace content. Transport only: waterfall order is the
 * application's; viewer redactions resolve per request, handed through unchanged.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { TraceApi, promptStudioSpanSchema, spansTrpc } from "@langwatch/trace-contract";

export const spansTrpcTransport: TrpcRouterDeclaration<TraceApi, typeof spansTrpc> =
  defineTrpcRouter(TraceApi, spansTrpc)
    .procedure("getAllForTrace")
    .withPermission("traces:view")
    .handle(async ({ app, input, actor }) => {
      const protections = await app.resolveViewerProtections({
        projectId: input.projectId,
        userId: actor.id,
      });

      return app.readOrderedSpansForTrace({
        projectId: input.projectId,
        traceId: input.traceId,
        protections,
      });
    })

    .procedure("getForPromptStudio")
    .withPermission("traces:view")
    .handle(async ({ app, input, actor }) =>
      promptStudioSpanSchema.parse(
        await app.getPromptStudioSpan({
          projectId: input.projectId,
          spanId: input.spanId,
          viewerUserId: actor.id,
        }),
      ),
    )
    .build();

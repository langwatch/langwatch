/**
 * The server half of `spans.*`. Both procedures take `traces:view` - a span
 * is trace content, and nothing here is readable to a caller who may not read
 * the trace it belongs to. Transport only: the waterfall order is the
 * application's, not this door's, and the viewer's redactions are resolved
 * per request and handed to the read unchanged.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { SpanNotFoundError, TraceApi, spansTrpc } from "@langwatch/trace-contract";

export const spansTrpcTransport = defineTrpcRouter(TraceApi, spansTrpc)
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
  .handle(async ({ app, input, actor }) => {
    const { projectId, spanId } = input;
    const protections = await app.resolveViewerProtections({ projectId, userId: actor.id });

    const result = await app.readPromptStudioSpan({ projectId, spanId, protections });

    if (!result) throw new SpanNotFoundError(spanId);

    return result;
  })
  .build();

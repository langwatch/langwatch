/**
 * The server half of `spans.*`. Both procedures take `traces:view` — a
 * span is trace content. Transport only: waterfall order is the
 * application's; viewer redactions resolve per request, handed through unchanged.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import {
  SpanNotFoundError,
  TraceApi,
  promptStudioSpanSchema,
  spansTrpc,
} from "@langwatch/trace-contract";

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

    const result = await app.findPromptStudioSpan({ projectId, spanId, protections });

    if (!result) throw new SpanNotFoundError(spanId);

    return promptStudioSpanSchema.parse(result);
  })
  .build();

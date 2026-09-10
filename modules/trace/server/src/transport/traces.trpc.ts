/**
 * The server half of `traces.*`. Every procedure takes `traces:view`.
 * Transport only: policy and delegation to `TraceApp`. Which reads resolve
 * offloaded values in full and which stay on the stored preview is the
 * application's decision, not this door's. Anonymous shared reads are NOT
 * here - see `sharedTrace.get` (ADR-057).
 */
import { on } from "node:events";
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { TraceApi, TraceNotFoundError, tracesTrpc } from "@langwatch/trace-contract";

import { TraceReadableSpanService } from "../services/read/trace-readable-span.service.ts";

export const tracesTrpcTransport = defineTrpcRouter(TraceApi, tracesTrpc)
  .procedure("getAllForProject")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) => {
    const protections = await app.resolveViewerProtections({
      projectId: input.projectId,
      userId: actor.id,
    });

    return app.listTraces({
      query: input,
      protections,
      options: { scrollId: input.scrollId },
    });
  })

  .procedure("getById")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) => {
    const protections = await app.resolveViewerProtections({
      projectId: input.projectId,
      userId: actor.id,
    });

    const trace = await app.readTrace({
      projectId: input.projectId,
      traceId: input.traceId,
      protections,
      withEditOverlay: input.withEditOverlay,
    });

    if (!trace) throw new TraceNotFoundError(input.traceId);

    return trace;
  })

  .procedure("getEvaluations")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) => {
    const protections = await app.resolveViewerProtections({
      projectId: input.projectId,
      userId: actor.id,
    });

    const evaluations = await app.readEvaluations({
      projectId: input.projectId,
      traceIds: [input.traceId],
      protections,
    });

    return evaluations[input.traceId];
  })

  .procedure("getEvaluationInputs")
  .withPermission("traces:view")
  .handle(({ app, input }) =>
    app.readEvaluationInputs({ projectId: input.projectId, evaluationId: input.evaluationId }),
  )

  .procedure("getEvaluationsMultiple")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) => {
    const protections = await app.resolveViewerProtections({
      projectId: input.projectId,
      userId: actor.id,
    });

    return app.readEvaluations({ projectId: input.projectId, traceIds: input.traceIds, protections });
  })

  .procedure("getTopicCounts")
  .withPermission("traces:view")
  .handle(async ({ app, input }) => {
    const result = await app.readTopicCounts(input);

    const topicsMap = Object.fromEntries(
      (await app.readTopics({ projectId: input.projectId })).map((topic) => [topic.id, topic]),
    );

    const mapBuckets = (buckets: Array<{ key: string; count: number }>, includeParent = false) => {
      return buckets.reduce(
        (acc, bucket) => {
          const topic = topicsMap[bucket.key];
          if (!topic) return acc;

          return [
            ...acc,
            {
              id: bucket.key,
              name: topic.name,
              count: bucket.count,
              ...(includeParent && { parentId: topic.parentId }),
            },
          ];
        },
        [] as { id: string; name: string; count: number; parentId?: string | null }[],
      );
    };

    return {
      topicCounts: mapBuckets(result.topicCounts),
      subtopicCounts: mapBuckets(result.subtopicCounts, true),
    };
  })

  .procedure("getCustomersAndLabels")
  .withPermission("traces:view")
  .handle(({ app, input }) => app.readCustomersAndLabels(input))

  .procedure("getTracesByThreadId")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) => {
    const { projectId, threadId } = input;
    const protections = await app.resolveViewerProtections({ projectId, userId: actor.id });

    // Thread-detail read consumes conversation content, so the application
    // resolves full IO (#4991) rather than the 64 KB preview. Anonymous
    // shared reads go through the dedicated `sharedTrace.get` surface, never
    // this endpoint. See ADR-057.
    return app.readThreadTraces({ projectId, threadId, protections });
  })

  .procedure("getTracesWithSpans")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) => {
    const { projectId, traceIds } = input;
    const protections = await app.resolveViewerProtections({ projectId, userId: actor.id });

    return app.readTracesWithSpans({
      projectId,
      traceIds,
      protections,
      withEditOverlay: input.withEditOverlay,
    });
  })

  .procedure("getFormattedSpansDigest")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) => {
    const { projectId, traceIds } = input;
    const protections = await app.resolveViewerProtections({ projectId, userId: actor.id });

    // The digest is one more reading of the same spans the other columns are
    // mapped from, so the correction is read the same way. Read without it,
    // the one column that quotes the whole trace would spell out the very
    // spans the reviewer deleted.
    //
    // It stays on previews all the same: this runs over a whole page of
    // traces at once, and resolving every offloaded value on all of them is
    // what #4991 kept off the grid. Applying a correction needs none of it.
    const traces = await app.readTracesWithSpansPreview({
      projectId,
      traceIds,
      protections,
      withEditOverlay: input.withEditOverlay,
    });

    // `as const` is what keeps the answer a `Record<string, string>`: the
    // `await` between the map and `Object.fromEntries` breaks the contextual
    // typing that would infer the entry as a two-tuple, so untupled this
    // lands on the `Iterable<readonly any[]>: any` overload and erases the
    // procedure's output.
    return Object.fromEntries(
      await Promise.all(
        traces.map(
          async (t) => [t.trace_id, await TraceReadableSpanService.formatSpansDigest(t.spans ?? [])] as const,
        ),
      ),
    );
  })

  .procedure("getTracesWithSpansByThreadIds")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) => {
    const { projectId, threadIds } = input;
    const protections = await app.resolveViewerProtections({ projectId, userId: actor.id });

    // Thread reads consume conversation content, so the application resolves
    // full IO (#4991).
    return app.readThreadsTraces({
      projectId,
      threadIds,
      protections,
      withEditOverlay: input.withEditOverlay,
    });
  })

  .procedure("getSampleTracesDataset")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) => {
    const protections = await app.resolveViewerProtections({
      projectId: input.projectId,
      userId: actor.id,
    });

    // Dataset builder persists trace content, so the application resolves
    // full IO (#4991) and truncated rows never corrupt the dataset. The
    // ID-only list read it draws from stays on the preview.
    return app.readSampleTraces({ query: input, protections, pageSize: 10 });
  })

  .procedure("getFieldNames")
  .withPermission("traces:view")
  .handle(({ app, input }) =>
    app.readFieldNames({
      projectId: input.projectId,
      startDate: input.startDate,
      endDate: input.endDate,
    }),
  )

  .procedure("getAllForDownload")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) => {
    const protections = await app.resolveViewerProtections({
      projectId: input.projectId,
      userId: actor.id,
    });

    // A download consumes trace content, so it must never serve the 64 KB
    // preview (#4991 AC1) - and that holds whether or not spans are
    // included, because the returned traces carry trace-level
    // `input`/`output` either way. Gating resolveBlobs on includeSpans (as
    // this did) silently truncated any offloaded trace in a spans-less
    // download, the same data-loss bug fixed in ExportService for
    // summary-mode exports.
    return app.listTraces({
      query: { ...input, pageSize: input.pageSize ?? 10_000 },
      protections,
      options: {
        downloadMode: true,
        includeSpans: input.includeSpans,
        resolveBlobs: true,
        scrollId: input.scrollId,
      },
    });
  })

  .procedure("onTraceUpdate")
  .withPermission("traces:view")
  .handle(async function* ({ app, input, signal }) {
    const { projectId } = input;
    const emitter = app.getTenantEmitter(projectId);

    try {
      for await (const eventArgs of on(emitter, "trace_updated", { signal })) {
        yield eventArgs[0];
      }
    } finally {
      app.cleanupTenantEmitter(projectId);
    }
  })
  .build();

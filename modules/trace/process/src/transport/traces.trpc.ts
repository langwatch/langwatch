/**
 * The server half of `traces.*`. Every procedure takes `traces:view`.
 * Transport only, delegating to `TraceApp`. Anonymous shared reads are NOT
 * here — see `sharedTrace.get` (ADR-057).
 */
import { on } from "node:events";

import { defineTrpcRouter } from "@langwatch/api/trpc";
import {
  customersAndLabelsResultSchema,
  distinctFieldNamesResultSchema,
  evaluationSchema,
  TraceApi,
  TraceNotFoundError,
  topicCountsResultSchema,
  tracesTrpc,
} from "@langwatch/trace-contract";

import { TraceReadableSpanService } from "../services/trace-readable-span.service.ts";

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

    const trace = await app.findTrace({
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

    return evaluationSchema.array().optional().parse(evaluations[input.traceId]);
  })

  .procedure("getEvaluationInputs")
  .withPermission("traces:view")
  .handle(({ app, input }) =>
    app.findEvaluationInputs({ projectId: input.projectId, evaluationId: input.evaluationId }),
  )

  .procedure("getEvaluationsMultiple")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) => {
    const protections = await app.resolveViewerProtections({
      projectId: input.projectId,
      userId: actor.id,
    });

    const evaluations = await app.readEvaluations({
      projectId: input.projectId,
      traceIds: input.traceIds,
      protections,
    });

    return Object.fromEntries(
      Object.entries(evaluations).map(([traceId, traceEvaluations]) => [
        traceId,
        evaluationSchema.array().parse(traceEvaluations),
      ]),
    );
  })

  .procedure("getTopicCounts")
  .withPermission("traces:view")
  .handle(async ({ app, input }) => {
    const result = topicCountsResultSchema.parse(await app.readTopicCounts(input));

    const topicsMap = Object.fromEntries(
      (await app.readTopics({ projectId: input.projectId })).map((topic) => [topic.id, topic]),
    );

    const mapBuckets = (buckets: { key: string; count: number }[], includeParent = false) => {
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
  .handle(async ({ app, input }) =>
    customersAndLabelsResultSchema.parse(await app.readCustomersAndLabels(input)),
  )

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

    // The digest reads the same spans the other columns map from; without
    // it, the trace-quoting column would spell out spans the reviewer
    // deleted. Stays on previews: #4991 avoided resolving every offload on a whole page.
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
          async (t) =>
            [t.trace_id, await TraceReadableSpanService.formatSpansDigest(t.spans ?? [])] as const,
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
  .handle(async ({ app, input }) =>
    distinctFieldNamesResultSchema.parse(
      await app.readFieldNames({
        projectId: input.projectId,
        startDate: input.startDate,
        endDate: input.endDate,
      }),
    ),
  )

  .procedure("getAllForDownload")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) => {
    const protections = await app.resolveViewerProtections({
      projectId: input.projectId,
      userId: actor.id,
    });

    // A download must never serve the 64 KB preview (#4991 AC1), spans or
    // not — traces carry trace-level input/output either way. Gating
    // resolveBlobs on includeSpans silently truncated spans-less downloads.
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

/**
 * The server half of `traces.*`, delegating to `TraceApp`. Anonymous shared
 * reads are NOT here (`sharedTrace.get`, ADR-057). `aiQuery`/`aiAction`
 * throw `service_unavailable` — see the merge-traces-v2 handoff.
 */
import { on } from "node:events";

import { defineTrpcRouter } from "@langwatch/api/trpc";
import { ValidationError } from "@langwatch/handled-error";
import { nowInstant } from "@langwatch/time";
import {
  changeTraceNameInputSchema,
  customersAndLabelsResultSchema,
  discoverResultSchema,
  distinctFieldNamesResultSchema,
  evaluationSchema,
  facetValuesResultSchema,
  SpanNotFoundError,
  TRACE_NAME_MAX_LENGTH,
  TRACE_NAME_MIN_LENGTH,
  TraceAiQueryUnavailableError,
  TraceApi,
  TraceNotFoundError,
  traceListPageSchema,
  traceSummaryDataSchema,
  tracesEvaluationRunsSchema,
  topicCountsResultSchema,
  tracesTrpc,
  sessionGroupsResultSchema,
} from "@langwatch/trace-contract";

import {
  traceDerivedAttrPrefixes,
  traceReadMapperPorts,
} from "./api-trpc/trace-read-mapper-ports.ts";
import {
  buildContentPrivacy,
  buildSpanContentRedactions,
  contentSearchTermsForViewer,
  gateTraceLogVisibility,
  mapLegacySpanSummaryToTreeNode,
  mapSpansToDetailDtos,
  mapSpanToDetail,
  mapTraceSummaryToHeader,
  readDroppedFromParams,
  readPiiIncompleteFromParams,
  redactV2Content,
  toConversationContextTurn,
} from "./api-trpc/trace-read-mappers.api.ts";
import {
  gateHeaderCost,
  gateResources,
  gateSessionCost,
  gateSessionTitle,
  gateTreeCost,
  withoutHiddenResourceAttrs,
} from "./api-trpc/trace-view-gates.api.ts";

const evaluationsSchema = evaluationSchema.array();

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
        evaluationsSchema.parse(traceEvaluations),
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
          async (t) => [t.trace_id, await app.formatSpansDigest({ spans: t.spans ?? [] })] as const,
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

  .procedure("getSampleTraces")
  .withPermission("traces:view")
  .handle(({ app, input, actor }) => {
    const { evaluatorType, preconditions, expectedResults, ...query } = input;

    return app.readPreconditionSampleTraces({
      query,
      viewerUserId: actor.id,
      evaluatorType,
      preconditions,
      expectedResults,
    });
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

  // ---------------------------------------------------------------------
  // The explorer's grid, sidebar and drawer reads (formerly `traces.*`)
  // ---------------------------------------------------------------------

  .procedure("list")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) => {
    const protections = await app.resolveViewerProtections({
      projectId: input.projectId,
      userId: actor.id,
    });
    const filterWhere = app.compileExplorerTraceFilter({
      query: input.query ?? "",
      tenantId: input.projectId,
      timeRange: input.timeRange,
      evalRuns: await app.findExplorerEvalRuns({
        projectId: input.projectId,
        evalRuns: input.evalRuns,
      }),
    });
    const page = traceListPageSchema.parse(
      await app.readTraceList({
        tenantId: input.projectId,
        timeRange: input.timeRange,
        sort: input.sort,
        page: input.page,
        pageSize: input.pageSize,
        cursor: input.cursor,
        filterWhere,
        visibilityCutoffMs: protections.visibilityCutoffMs,
      }),
    );

    return {
      ...page,
      items: page.items.map((item) =>
        redactV2Content(item, protections, traceReadMapperPorts.contentPrivacy),
      ),
    };
  })

  /**
   * Sessions lens: one row per `gen_ai.conversation.id` with rollups computed in
   * ClickHouse over every trace in range, not just the fetched page.
   */
  .procedure("sessions")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) => {
    const protections = await app.resolveViewerProtections({
      projectId: input.projectId,
      userId: actor.id,
    });
    const filterWhere = app.compileExplorerTraceFilter({
      query: input.query ?? "",
      tenantId: input.projectId,
      timeRange: input.timeRange,
      evalRuns: await app.findExplorerEvalRuns({
        projectId: input.projectId,
        evalRuns: input.evalRuns,
      }),
    });
    const result = sessionGroupsResultSchema.parse(
      await app.readSessionGroups({
        tenantId: input.projectId,
        timeRange: input.timeRange,
        sort: input.sort,
        pageSize: input.pageSize,
        cursor: input.cursor,
        filterWhere,
        contentTerms: contentSearchTermsForViewer({
          terms: app.extractTraceFreeTextTerms(input.query ?? ""),
          protections,
        }),
        visibilityCutoffMs: protections.visibilityCutoffMs,
      }),
    );

    return {
      ...result,
      sessions: gateSessionCost({
        sessions: gateSessionTitle({
          sessions: result.sessions.map((session) =>
            redactV2Content(session, protections, traceReadMapperPorts.contentPrivacy),
          ),
          protections,
        }),
        protections,
      }),
    };
  })

  /** Event rollups for the trace list's Events column, keyed by trace id. */
  .procedure("listEvents")
  .withPermission("traces:view")
  .handle(({ app, input }) =>
    app.readTraceEventRollups({
      projectId: input.projectId,
      traceIds: input.traceIds,
      timeRange: input.timeRange,
    }),
  )

  .procedure("newCount")
  .withPermission("traces:view")
  .handle(async ({ app, input }) => {
    const filterWhere = app.compileExplorerTraceFilter({
      query: input.query ?? "",
      tenantId: input.projectId,
      timeRange: input.timeRange,
      evalRuns: await app.findExplorerEvalRuns({
        projectId: input.projectId,
        evalRuns: input.evalRuns,
      }),
    });
    const count = await app.readNewCount({
      tenantId: input.projectId,
      timeRange: input.timeRange,
      since: input.since,
      filterWhere,
    });

    return { count };
  })

  .procedure("suggest")
  .withPermission("traces:view")
  .handle(async ({ app, input }) => {
    const values = await app.readSuggestions({
      tenantId: input.projectId,
      field: input.field,
      prefix: input.prefix,
      limit: input.limit,
    });

    return { values };
  })

  /**
   * Conversation/thread context for the trace drawer. Bypasses the search
   * query language so conversationIds with arbitrary characters work
   * unconditionally — builds a typed WHERE fragment directly.
   */
  .procedure("conversationContext")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) => {
    const protections = await app.resolveViewerProtections({
      projectId: input.projectId,
      userId: actor.id,
    });
    // Window: conversation membership is timeless; cap at 1y to keep
    // partition pruning effective.
    const now = nowInstant().epochMilliseconds;
    const timeRange = { from: now - 365 * 24 * 60 * 60 * 1000, to: now };
    const filterWhere = {
      sql: "Attributes['gen_ai.conversation.id'] = {threadConversationId:String}",
      params: { threadConversationId: input.conversationId },
    };
    const page = traceListPageSchema.parse(
      await app.readTraceList({
        tenantId: input.projectId,
        timeRange,
        sort: { columnId: "time", direction: "asc" },
        page: 1,
        pageSize: 200,
        filterWhere,
        visibilityCutoffMs: protections.visibilityCutoffMs,
      }),
    );
    const turns = page.items.map((t) =>
      toConversationContextTurn({
        trace: t,
        protections,
        contentPrivacy: traceReadMapperPorts.contentPrivacy,
      }),
    );

    return {
      conversationId: input.conversationId,
      turns,
      total: turns.length,
    };
  })

  .procedure("discover")
  .withPermission("traces:view")
  .handle(async ({ app, input }) => {
    // No `query` field at all is the vocabulary read; a `query` field, empty
    // string included, asks for counts under it (and the hidden origins).
    if (input.query === null || input.query === undefined) {
      return discoverResultSchema.parse(
        await app.readDiscover({ tenantId: input.projectId, timeRange: input.timeRange }),
      );
    }

    return discoverResultSchema.parse(
      await app.readFilteredFacets({
        projectId: input.projectId,
        timeRange: input.timeRange,
        query: input.query,
        evalRuns: await app.findExplorerEvalRuns({
          projectId: input.projectId,
          evalRuns: input.evalRuns,
        }),
      }),
    );
  })

  /**
   * Pushes `discover_updated` when a tenant's facet payload finishes
   * background refresh, mirroring `onTraceUpdate`.
   */
  .procedure("onDiscoverUpdate")
  .withPermission("traces:view")
  .handle(async function* ({ app, input, signal }) {
    const { projectId } = input;
    const emitter = app.getTenantEmitter(projectId);

    try {
      for await (const eventArgs of on(emitter, "discover_updated", { signal })) {
        yield eventArgs[0];
      }
    } finally {
      app.cleanupTenantEmitter(projectId);
    }
  })

  .procedure("facetValues")
  .withPermission("traces:view")
  .handle(({ app, input }) =>
    facetValuesResultSchema.parse(
      app.readFacetValues({
        tenantId: input.projectId,
        timeRange: input.timeRange,
        facetKey: input.facetKey,
        prefix: input.prefix,
        limit: input.limit,
        offset: input.offset,
      }),
    ),
  )

  /**
   * No model-invocation capability is wired into this transport yet — see
   * the merge-traces-v2 handoff. Declared (not dropped) so the namespace
   * carries the full `traces` shape; refuses by name instead of 404ing.
   */
  .procedure("aiQuery")
  .withPermission("traces:view")
  .handle(() => {
    throw new TraceAiQueryUnavailableError();
  })

  .procedure("aiAction")
  .withPermission("traces:view")
  .handle(() => {
    throw new TraceAiQueryUnavailableError();
  })

  /**
   * Enter on a sentence, routed. Refuses for the same reason `aiQuery` does:
   * every route but the phrase needs a model this transport cannot call yet.
   */
  .procedure("routeSearch")
  .withPermission("traces:view")
  .handle(() => {
    throw new TraceAiQueryUnavailableError();
  })

  /**
   * The Explorer's Instant Eval. Permissions match the REST family:
   * `analytics:manage` to spend, `analytics:view` to read a run back.
   */
  .procedure("instantEvalEstimate")
  .withPermission("analytics:manage")
  .handle(({ app, input, actor }) =>
    app.estimateExplorerEvalRun({ request: input, userId: actor.id }),
  )

  .procedure("instantEvalStart")
  .withPermission("analytics:manage")
  .handle(({ app, input, actor }) => app.startExplorerEvalRun({ request: input, userId: actor.id }))

  .procedure("instantEvalCancel")
  .withPermission("analytics:manage")
  .handle(({ app, input, actor }) =>
    app.cancelExplorerEvalRun({
      projectId: input.projectId,
      runId: input.runId,
      requestedByUserId: actor.id,
    }),
  )

  .procedure("instantEvalGet")
  .withPermission("analytics:view")
  .handle(({ app, input }) =>
    app.getExplorerEvalRun({ projectId: input.projectId, runId: input.runId }),
  )

  .procedure("header")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) => {
    const protections = await app.resolveViewerProtections({
      projectId: input.projectId,
      userId: actor.id,
    });
    const summary = traceSummaryDataSchema.parse(
      await app.readTraceSummary({
        projectId: input.projectId,
        traceId: input.traceId,
        occurredAtMs: input.occurredAtMs,
        visibilityCutoffMs: protections.visibilityCutoffMs,
        full: input.full,
      }),
    );
    const rawHeader = mapTraceSummaryToHeader(summary);
    // Cost is gated by the viewer's own `cost:view` (via `protections`), the
    // same rule the detail-pane spans apply through `applySpanProtections`.
    const header = gateHeaderCost({
      header: redactV2Content(rawHeader, protections, traceReadMapperPorts.contentPrivacy),
      protections,
    });
    // The "content dropped at ingestion" banner needs a live data-privacy
    // policy read this transport does not have wired yet (merge-traces-v2
    // handoff), so it stays unset rather than guessed.
    header.privacy = null;

    return header;
  })

  /**
   * Trim happens here so the event always carries a canonical form; rejections
   * surface as a `ValidationError` (HandledError).
   */
  .procedure("changeName")
  .withPermission("traces:update")
  .handle(async ({ app, input, actor }) => {
    const trimmed = input.newName.trim();
    const parsed = changeTraceNameInputSchema.safeParse({ newName: trimmed });
    if (!parsed.success) {
      throw new ValidationError(
        `Trace name must be between ${TRACE_NAME_MIN_LENGTH} and ${TRACE_NAME_MAX_LENGTH} characters after trimming`,
        {
          meta: {
            field: "newName",
            minLength: TRACE_NAME_MIN_LENGTH,
            maxLength: TRACE_NAME_MAX_LENGTH,
            receivedLength: trimmed.length,
            fieldErrors: parsed.error.flatten().fieldErrors,
          },
        },
      );
    }

    await app.changeTraceName(
      { projectId: input.projectId, traceId: input.traceId, newName: parsed.data.newName },
      actor,
    );

    return { traceId: input.traceId, newName: parsed.data.newName };
  })

  .procedure("evals")
  .withPermission("traces:view")
  .handle(({ app, input }) =>
    tracesEvaluationRunsSchema.parse(
      app.readEvaluationRuns({ tenantId: input.projectId, traceId: input.traceId }),
    ),
  )

  .procedure("traceLogs")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) => {
    const protections = await app.resolveViewerProtections({
      projectId: input.projectId,
      userId: actor.id,
    });
    const rows = await app.readTraceLogRecords({
      projectId: input.projectId,
      traceId: input.traceId,
      occurredAtMs: input.occurredAtMs,
    });

    return rows.map((row) =>
      gateTraceLogVisibility({
        row,
        protections,
        visibilityCutoffMs: protections.visibilityCutoffMs ?? null,
        codingAgents: {
          logContentKeys: (eventName) =>
            app.codingAgentLogContentKeys(eventName).map((entry) => ({
              key: entry.key,
              category: entry.category,
            })),
        },
        derivedAttrPrefixes: traceDerivedAttrPrefixes,
      }),
    );
  })

  .procedure("codingAgentTranscript")
  .withPermission("traces:view")
  .handle(({ app, input, actor }) =>
    app.readCodingAgentTranscript({
      projectId: input.projectId,
      traceId: input.traceId,
      occurredAtMs: input.occurredAtMs,
      viewerUserId: actor.id,
    }),
  )

  .procedure("codingAgentSession")
  .withPermission("traces:view")
  .handle(({ app, input }) =>
    app.readCodingAgentSession({ projectId: input.projectId, traceId: input.traceId }),
  )

  .procedure("spansPaginated")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) => {
    const protections = await app.resolveViewerProtections({
      projectId: input.projectId,
      userId: actor.id,
    });
    const page = await app.readSpansPage({
      projectId: input.projectId,
      traceId: input.traceId,
      visibilityCutoffMs: protections.visibilityCutoffMs,
      limit: input.limit,
      offset: input.offset,
      occurredAtMs: input.occurredAtMs,
    });
    const redactions = buildSpanContentRedactions(
      page.spans,
      protections,
      traceReadMapperPorts.spanProtection,
    );

    return {
      ...page,
      spans: page.spans.map((span) =>
        traceReadMapperPorts.spanProtection.applySpanProtections(span, protections, redactions),
      ),
    };
  })

  .procedure("spansDelta")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) => {
    const protections = await app.resolveViewerProtections({
      projectId: input.projectId,
      userId: actor.id,
    });
    const sinceSpans = await app.readSpansSince({
      projectId: input.projectId,
      traceId: input.traceId,
      sinceStartTimeMs: input.sinceStartTimeMs,
      visibilityCutoffMs: protections.visibilityCutoffMs,
      occurredAtMs: input.occurredAtMs,
    });
    const redactions = buildSpanContentRedactions(
      sinceSpans,
      protections,
      traceReadMapperPorts.spanProtection,
    );

    return sinceSpans.map((span) =>
      traceReadMapperPorts.spanProtection.applySpanProtections(span, protections, redactions),
    );
  })

  /**
   * One page of the span tree in `(startTimeMs, spanId)` order — the only
   * fetch path the frontend uses; traces can carry 20k-100k+ spans.
   */
  .procedure("spanTreePaginated")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) => {
    const protections = await app.resolveViewerProtections({
      projectId: input.projectId,
      userId: actor.id,
    });

    return app.readSpanTreePage({ ...input, canSeeCosts: protections.canSeeCosts === true });
  })

  .procedure("spanTreeDelta")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) => {
    const protections = await app.resolveViewerProtections({
      projectId: input.projectId,
      userId: actor.id,
    });

    return app.readSpanTreeDelta({ ...input, canSeeCosts: protections.canSeeCosts === true });
  })

  /**
   * Whole-tree read in one response. The frontend no longer fetches through
   * this — `spanTreePaginated` pages instead — but this stays as that cache
   * entry's type/key anchor.
   */
  .procedure("spanTree")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) => {
    const protections = await app.resolveViewerProtections({
      projectId: input.projectId,
      userId: actor.id,
    });
    const rows = await app.readSpanSummaries({
      projectId: input.projectId,
      traceId: input.traceId,
      occurredAtMs: input.occurredAtMs,
    });

    return gateTreeCost({ nodes: rows.map(mapLegacySpanSummaryToTreeNode), protections });
  })

  .procedure("spanLangwatchSignals")
  .withPermission("traces:view")
  .handle(async ({ app, input }) => {
    const rows = await app.readLangwatchSignals({
      projectId: input.projectId,
      traceId: input.traceId,
      occurredAtMs: input.occurredAtMs,
    });

    return rows.map((r) => ({ spanId: r.spanId, signals: r.signals }));
  })

  /**
   * Full span data for every span in a trace — used by the LLM Optimized
   * Trace markdown view. Heavier than spanTree; fetch lazily.
   */
  .procedure("spansFull")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) => {
    const protections = await app.resolveViewerProtections({
      projectId: input.projectId,
      userId: actor.id,
    });
    const storedSpans = await app.readSpans({
      projectId: input.projectId,
      traceId: input.traceId,
      occurredAtMs: input.occurredAtMs,
      visibilityCutoffMs: protections.visibilityCutoffMs,
    });
    // Claude Code's real `llm_request` spans carry tokens + `request_id` but NO
    // message content, which lives in the trace's OTLP log records. Joined on
    // BEFORE protections run, so it goes through the same redaction pass.
    const spans = await app.enrichSpansFromCodingAgentLogs({
      projectId: input.projectId,
      traceId: input.traceId,
      spans: storedSpans,
      ...(input.occurredAtMs !== undefined ? { occurredAtMs: input.occurredAtMs } : {}),
    });

    return mapSpansToDetailDtos(spans, protections, traceReadMapperPorts);
  })

  .procedure("spanDetail")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) => {
    const protections = await app.resolveViewerProtections({
      projectId: input.projectId,
      userId: actor.id,
    });
    const [span, rawEvents] = await Promise.all([
      app.findSpan({
        projectId: input.projectId,
        traceId: input.traceId,
        spanId: input.spanId,
        visibilityCutoffMs: protections.visibilityCutoffMs,
        occurredAtMs: input.occurredAtMs,
      }),
      app.readSpanEvents({
        projectId: input.projectId,
        traceId: input.traceId,
        spanId: input.spanId,
        occurredAtMs: input.occurredAtMs,
      }),
    ]);

    if (!span) throw new SpanNotFoundError(input.spanId);

    // Coding-agent spans store their content in the trace's OTLP LOGS, not on
    // the span row — join it on here, BEFORE protections, so it goes through
    // the same redaction pass as any other span content.
    let targetSpan = span;
    if (app.isCodingAgentShapedSpan(span)) {
      const needsSiblingRefs =
        typeof (span.params as Record<string, unknown> | null)?.request_id === "string";
      const [logRows, summaryRows] = await Promise.all([
        app.readTraceLogRecords({
          projectId: input.projectId,
          traceId: input.traceId,
          occurredAtMs: input.occurredAtMs,
        }),
        needsSiblingRefs
          ? app.readSpanSummaries({
              projectId: input.projectId,
              traceId: input.traceId,
              occurredAtMs: input.occurredAtMs,
            })
          : Promise.resolve([]),
      ]);
      targetSpan = app.enrichSpanFromCodingAgentLogs({
        span,
        modelCallRefs: app.mapCodingAgentSummaryRows(summaryRows),
        logRows,
      });
    }

    const redactions = buildSpanContentRedactions(
      [targetSpan],
      protections,
      traceReadMapperPorts.spanProtection,
    );
    const protectedSpan = traceReadMapperPorts.spanProtection.applySpanProtections(
      targetSpan,
      protections,
      redactions,
    );
    const spanDetail = mapSpanToDetail(
      protectedSpan,
      rawEvents.map((e) => ({
        name: e.event_type,
        timeUnixMs:
          typeof e.timestamps.started_at === "number"
            ? e.timestamps.started_at
            : parseInt(String(e.timestamps.started_at), 10),
        attributes: traceReadMapperPorts.spanProtection.redactObject(
          Object.fromEntries([
            ...e.event_details.map((d): [string, unknown] => [d.key, d.value]),
            ...e.metrics.map((m): [string, unknown] => [m.key, m.value]),
          ]),
          redactions,
        ),
      })),
      traceReadMapperPorts.spanDisplay,
    );

    const redactedDetail = redactV2Content(
      spanDetail,
      protections,
      traceReadMapperPorts.contentPrivacy,
    );
    const detailParams = spanDetail.params as Record<string, unknown> | null;
    redactedDetail.contentPrivacy = buildContentPrivacy(
      protections,
      readDroppedFromParams(detailParams, traceReadMapperPorts.contentPrivacy),
    );
    redactedDetail.piiAnalysisIncomplete = readPiiIncompleteFromParams(
      detailParams,
      traceReadMapperPorts.contentPrivacy,
    );
    redactedDetail.restrictedAttributes = protections.restrictedAttributes ?? null;

    return redactedDetail;
  })

  /**
   * OTel resource attributes + instrumentation scope per span. Standard span
   * mapping drops both, so this reads them raw.
   */
  .procedure("resourceInfo")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) => {
    const protections = await app.resolveViewerProtections({
      projectId: input.projectId,
      userId: actor.id,
    });
    const rows = await app.readSpanResources({
      projectId: input.projectId,
      traceId: input.traceId,
      occurredAtMs: input.occurredAtMs,
    });
    const resourceSpans = rows.map((r) => ({
      spanId: r.spanId,
      parentSpanId: r.parentSpanId,
      resourceAttributes: withoutHiddenResourceAttrs(r.resourceAttributes),
      scope: { name: r.scopeName ?? "", version: r.scopeVersion },
    }));
    const root = rows.find((r) => r.parentSpanId == null) ?? rows[0] ?? null;

    return gateResources({
      resources: {
        rootSpanId: root?.spanId ?? null,
        resourceAttributes: withoutHiddenResourceAttrs(root?.resourceAttributes ?? {}),
        scope: root ? { name: root.scopeName ?? "", version: root.scopeVersion } : null,
        spans: resourceSpans,
      },
      protections,
    });
  })

  /**
   * Trace-level events for the drawer, split off the header so the header
   * stays a pure summary read.
   */
  .procedure("traceEvents")
  .withPermission("traces:view")
  .handle(async ({ app, input, actor }) => {
    const protections = await app.resolveViewerProtections({
      projectId: input.projectId,
      userId: actor.id,
    });
    const events = await app.readTraceEvents({
      projectId: input.projectId,
      traceId: input.traceId,
      occurredAtMs: input.occurredAtMs,
    });

    return traceReadMapperPorts.spanProtection.applyDerivedTraceEventProtections(
      events,
      protections,
    );
  })
  .build();

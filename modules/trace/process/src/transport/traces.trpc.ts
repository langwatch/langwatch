/**
 * The server half of `traces.*`, delegating to `TraceModule`. Anonymous shared
 * reads are NOT here (`sharedTrace.get`, ADR-057). `aiQuery`/`aiAction`
 * throw `service_unavailable` — see the merge-traces-v2 handoff.
 */

import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { narrowAuthorization } from "@langwatch/authorization";
import {
  customersAndLabelsResultSchema,
  discoverResultSchema,
  distinctFieldNamesResultSchema,
  evaluationSchema,
  facetValuesResultSchema,
  TraceAiQueryUnavailableError,
  TraceApi,
  traceListPageSchema,
  traceSummaryReadSchema,
  tracesEvaluationRunsSchema,
  tracesTrpc,
} from "@langwatch/trace-contract";

import {
  traceDerivedAttrPrefixes,
  traceReadMapperPorts,
} from "../rules/trace-read-mapper-ports.rules.ts";
import {
  buildSpanContentRedactions,
  deriveTraceDropPrivacy,
  gateTraceLogVisibility,
  mapLegacySpanSummaryToTreeNode,
  mapSpansToDetailDtos,
  mapTraceSummaryToHeader,
  redactV2Content,
} from "../rules/trace-read-mappers.rules.ts";
import {
  gateHeaderCost,
  gateResources,
  gateTreeCost,
  withoutHiddenResourceAttrs,
} from "../rules/trace-view-gates.rules.ts";

const evaluationsSchema = evaluationSchema.array();

export const tracesTrpcTransport: TrpcRouterDeclaration<TraceApi, typeof tracesTrpc> =
  defineTrpcRouter(TraceApi, tracesTrpc)
    .procedure("getAllForProject")
    .withPermission("traces:view")
    .handle(async ({ app, input, actor, authorization }) => {
      const protections = await app.resolveViewerProtections({
        projectId: input.projectId,
        userId: actor.id,
        authorization,
      });

      return app.listTraces({
        query: input,
        protections,
        options: { scrollId: input.scrollId, refuseAbove: "tracesPageSizeMax", authorization },
      });
    })

    .procedure("getById")
    .withPermission("traces:view")
    .handle(({ app, input, actor }) =>
      app.getTraceForViewer({
        projectId: input.projectId,
        traceId: input.traceId,
        withEditOverlay: input.withEditOverlay,
        viewerUserId: actor.id,
      }),
    )

    .procedure("getEvaluations")
    .withPermission("traces:view")
    .handle(async ({ app, input, actor, authorization }) => {
      const evaluations = await app.readEvaluations({
        ...input,
        authorization,
        viewerUserId: actor.id,
      });

      return evaluationSchema.array().optional().parse(evaluations[input.traceId]);
    })

    .procedure("getEvaluationsMultiple")
    .withPermission("traces:view")
    .handle(async ({ app, input, actor, authorization }) => {
      const protections = await app.resolveViewerProtections({
        projectId: input.projectId,
        userId: actor.id,
        authorization,
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

    .procedure("getCustomersAndLabels")
    .withPermission("traces:view")
    .handle(async ({ app, input }) =>
      customersAndLabelsResultSchema.parse(await app.readCustomersAndLabels(input)),
    )

    .procedure("getTracesByThreadId")
    .withPermission("traces:view")
    .handle(async ({ app, input, actor, authorization }) => {
      const { projectId, threadId } = input;
      const protections = await app.resolveViewerProtections({
        projectId,
        userId: actor.id,
        authorization,
      });

      // Thread-detail read consumes conversation content, so the application
      // resolves full IO (#4991) rather than the 64 KB preview. Anonymous
      // shared reads go through the dedicated `sharedTrace.get` surface, never
      // this endpoint. See ADR-057.
      return app.readThreadTraces({ projectId, threadId, protections });
    })

    .procedure("getTracesWithSpans")
    .withPermission("traces:view")
    .handle(async ({ app, input, actor, authorization }) => {
      const { projectId, traceIds } = input;
      const protections = await app.resolveViewerProtections({
        projectId,
        userId: actor.id,
        authorization,
      });

      return app.readTracesWithSpans({
        projectId,
        traceIds,
        protections,
        withEditOverlay: input.withEditOverlay,
      });
    })

    .procedure("getFormattedSpansDigest")
    .withPermission("traces:view")
    .handle(async ({ app, input, actor, authorization }) => {
      const { projectId, traceIds } = input;
      const protections = await app.resolveViewerProtections({
        projectId,
        userId: actor.id,
        authorization,
      });

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
              [t.trace_id, await app.formatSpansDigest({ spans: t.spans ?? [] })] as const,
          ),
        ),
      );
    })

    .procedure("getTracesWithSpansByThreadIds")
    .withPermission("traces:view")
    .handle(async ({ app, input, actor, authorization }) => {
      const { projectId, threadIds } = input;
      const protections = await app.resolveViewerProtections({
        projectId,
        userId: actor.id,
        authorization,
      });

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
    .handle(async ({ app, input, actor, authorization }) => {
      const protections = await app.resolveViewerProtections({
        projectId: input.projectId,
        userId: actor.id,
        authorization,
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

    // `project:view`, as on `project.getFieldRedactionStatus`: the path moved, not the gate.
    .procedure("getFieldRedactionStatus")
    .withPermission("project:view")
    .handle(async ({ app, input, actor }) => {
      const protections = await app.resolveViewerProtections({
        projectId: input.projectId,
        userId: actor.id,
      });

      return {
        isRedacted: {
          input: !protections.canSeeCapturedInput,
          output: !protections.canSeeCapturedOutput,
        },
        visibleTo: {
          input: protections.capturedInputVisibleTo ?? null,
          output: protections.capturedOutputVisibleTo ?? null,
        },
      };
    })

    .procedure("getAllForDownload")
    .withPermission("traces:view")
    .handle(async ({ app, input, actor, authorization }) => {
      const protections = await app.resolveViewerProtections({
        projectId: input.projectId,
        userId: actor.id,
        authorization,
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
          refuseAbove: "tracesDownloadPageSizeMax",
          authorization,
        },
      });
    })

    .procedure("onTraceUpdate")
    .withPermission("traces:view")
    .handle(async function* ({ app, input, signal }) {
      yield* app.streamTenantUpdates({
        projectId: input.projectId,
        eventName: "trace_updated",
        signal,
      });
    })

    // ---------------------------------------------------------------------
    // The explorer's grid, sidebar and drawer reads (formerly `traces.*`)
    // ---------------------------------------------------------------------

    .procedure("list")
    .withPermission("traces:view")
    .handle(async ({ app, input, actor, authorization }) => {
      const protections = await app.resolveViewerProtections({
        projectId: input.projectId,
        userId: actor.id,
        authorization,
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
          authorization,
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

    .procedure("listEvents")
    .withPermission("traces:view")
    .handle(({ app, input, authorization }) =>
      app.readTraceEventRollups({
        authorization,
        traceIds: input.traceIds,
        timeRange: input.timeRange,
      }),
    )

    .procedure("newCount")
    .withPermission("traces:view")
    .handle(async ({ app, input, authorization }) => {
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
        authorization,
        timeRange: input.timeRange,
        since: input.since,
        filterWhere,
      });

      return { count };
    })

    .procedure("suggest")
    .withPermission("traces:view")
    .handle(async ({ app, input, authorization }) => {
      const values = await app.readSuggestions({
        authorization,
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
    .handle(({ app, input, actor, authorization }) =>
      app.readConversationContextForViewer({
        projectId: input.projectId,
        authorization,
        conversationId: input.conversationId,
        tenantId: input.tenantId,
        viewerUserId: actor.id,
      }),
    )

    .procedure("discover")
    .withPermission("traces:view")
    .handle(async ({ app, input, authorization }) =>
      discoverResultSchema.parse(
        await app.readDiscoverForQuery({
          projectId: input.projectId,
          authorization,
          timeRange: input.timeRange,
          query: input.query,
          evalRuns: input.evalRuns,
        }),
      ),
    )

    /**
     * Pushes `discover_updated` when a tenant's facet payload finishes
     * background refresh, mirroring `onTraceUpdate`.
     */
    .procedure("onDiscoverUpdate")
    .withPermission("traces:view")
    .handle(async function* ({ app, input, signal }) {
      yield* app.streamTenantUpdates({
        projectId: input.projectId,
        eventName: "discover_updated",
        signal,
      });
    })

    .procedure("facets")
    .withPermission("traces:view")
    .handle(async ({ app, input, authorization }) =>
      discoverResultSchema.parse(
        await app.readFilteredFacets({
          projectId: input.projectId,
          authorization,
          timeRange: input.timeRange,
          query: input.query ?? "",
          evalRuns: await app.findExplorerEvalRuns({
            projectId: input.projectId,
            evalRuns: input.evalRuns,
          }),
        }),
      ),
    )

    .procedure("facetValues")
    .withPermission("traces:view")
    .handle(async ({ app, input, authorization }) =>
      facetValuesResultSchema.parse(
        await app.readFacetValues({
          authorization,
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

    .procedure("header")
    .withPermission("traces:view")
    .handle(async ({ app, input, authorization, actor }) => {
      const protections = await app.resolveViewerProtections({
        projectId: input.projectId,
        userId: actor.id,
        authorization,
      });
      const summary = traceSummaryReadSchema.parse(
        await app.readTraceSummary({
          authorization,
          traceId: input.traceId,
          tenantId: input.tenantId,
          occurredAtMs: input.occurredAtMs,
          visibilityCutoffMs: protections.visibilityCutoffMs,
          full: input.full,
        }),
      );
      const rawHeader = mapTraceSummaryToHeader(summary);
      // Privacy follows the member the trace was found in (ADR-177 decision 9).
      const memberProtections = await app.resolveViewerProtections({
        projectId: input.projectId,
        userId: actor.id,
        authorization:
          narrowAuthorization({ authorization, projectId: summary.tenantId }) ?? authorization,
      });
      // Cost is gated by the viewer's own `cost:view` (via `protections`), the
      // same rule the detail-pane spans apply through `applySpanProtections`.
      const header = gateHeaderCost({
        header: redactV2Content(rawHeader, memberProtections, traceReadMapperPorts.contentPrivacy),
        protections: memberProtections,
      });
      return {
        ...header,
        privacy: await deriveTraceDropPrivacy(
          rawHeader,
          summary.tenantId,
          traceReadMapperPorts.contentPrivacy,
        ),
        projectId: summary.tenantId,
      };
    })

    /**
     * Trim happens here so the event always carries a canonical form; rejections
     * surface as a `ValidationError` (HandledError).
     */
    .procedure("changeName")
    .withPermission("traces:update")
    .handle(({ app, input, actor }) =>
      app.renameTrace(
        { projectId: input.projectId, traceId: input.traceId, newName: input.newName },
        actor,
      ),
    )

    .procedure("changeMetadata")
    .withPermission("traces:update")
    .handle(async ({ app, input }) => {
      await app.updateTraceMetadata(input);
      return { traceId: input.traceId };
    })

    .procedure("evals")
    .withPermission("traces:view")
    .handle(async ({ app, input, authorization, actor }) =>
      tracesEvaluationRunsSchema.parse(
        await app.readEvaluationRuns({ ...input, authorization, viewerUserId: actor.id }),
      ),
    )

    .procedure("traceLogs")
    .withPermission("traces:view")
    .handle(async ({ app, input, actor, authorization }) => {
      const protections = await app.resolveViewerProtections({
        projectId: input.projectId,
        userId: actor.id,
        authorization,
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
          derivedAttrPrefixes: traceDerivedAttrPrefixes,
        }),
      );
    })

    .procedure("spansPaginated")
    .withPermission("traces:view")
    .handle(async ({ app, input, authorization: routeProof, actor }) => {
      const authorization = await app.authorizationForTrace({
        authorization: routeProof,
        traceId: input.traceId,
        tenantId: input.tenantId,
      });
      const protections = await app.resolveViewerProtections({
        projectId: input.projectId,
        userId: actor.id,
        authorization,
      });
      const page = await app.readSpansPage({
        authorization,
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
    .handle(async ({ app, input, authorization: routeProof, actor }) => {
      const authorization = await app.authorizationForTrace({
        authorization: routeProof,
        traceId: input.traceId,
        tenantId: input.tenantId,
      });
      const protections = await app.resolveViewerProtections({
        projectId: input.projectId,
        userId: actor.id,
        authorization,
      });
      const sinceSpans = await app.readSpansSince({
        authorization,
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
    .handle(async ({ app, input, actor, authorization: routeProof }) => {
      const authorization = await app.authorizationForTrace({
        authorization: routeProof,
        traceId: input.traceId,
        tenantId: input.tenantId,
      });
      const protections = await app.resolveViewerProtections({
        projectId: input.projectId,
        userId: actor.id,
        authorization,
      });

      return app.readSpanTreePage({
        ...input,
        authorization,
        canSeeCosts: protections.canSeeCosts === true,
      });
    })

    .procedure("spanTreeDelta")
    .withPermission("traces:view")
    .handle(async ({ app, input, actor, authorization: routeProof }) => {
      const authorization = await app.authorizationForTrace({
        authorization: routeProof,
        traceId: input.traceId,
        tenantId: input.tenantId,
      });
      const protections = await app.resolveViewerProtections({
        projectId: input.projectId,
        userId: actor.id,
        authorization,
      });

      return app.readSpanTreeDelta({
        ...input,
        authorization,
        canSeeCosts: protections.canSeeCosts === true,
      });
    })

    /**
     * Whole-tree read in one response. The frontend no longer fetches through
     * this — `spanTreePaginated` pages instead — but this stays as that cache
     * entry's type/key anchor.
     */
    .procedure("spanTree")
    .withPermission("traces:view")
    .handle(async ({ app, input, authorization: routeProof, actor }) => {
      const authorization = await app.authorizationForTrace({
        authorization: routeProof,
        traceId: input.traceId,
        tenantId: input.tenantId,
      });
      const protections = await app.resolveViewerProtections({
        projectId: input.projectId,
        userId: actor.id,
        authorization,
      });
      const rows = await app.readSpanSummaries({
        authorization,
        traceId: input.traceId,
        occurredAtMs: input.occurredAtMs,
      });

      return gateTreeCost({ nodes: rows.map(mapLegacySpanSummaryToTreeNode), protections });
    })

    .procedure("spanLangwatchSignals")
    .withPermission("traces:view")
    .handle(async ({ app, input, authorization: routeProof }) => {
      const authorization = await app.authorizationForTrace({
        authorization: routeProof,
        traceId: input.traceId,
        tenantId: input.tenantId,
      });
      const rows = await app.readLangwatchSignals({
        authorization,
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
    .handle(async ({ app, input, authorization: routeProof, actor }) => {
      const authorization = await app.authorizationForTrace({
        authorization: routeProof,
        traceId: input.traceId,
        tenantId: input.tenantId,
      });
      const protections = await app.resolveViewerProtections({
        projectId: input.projectId,
        userId: actor.id,
        authorization,
      });
      const storedSpans = await app.readSpans({
        authorization,
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
    .handle(async ({ app, input, actor, authorization }) =>
      app.readSpanDetailForViewer({
        projectId: input.projectId,
        authorization: await app.authorizationForTrace({
          authorization,
          traceId: input.traceId,
          tenantId: input.tenantId,
        }),
        traceId: input.traceId,
        spanId: input.spanId,
        occurredAtMs: input.occurredAtMs,
        viewerUserId: actor.id,
      }),
    )

    /**
     * OTel resource attributes + instrumentation scope per span. Standard span
     * mapping drops both, so this reads them raw.
     */
    .procedure("resourceInfo")
    .withPermission("traces:view")
    .handle(async ({ app, input, authorization: routeProof, actor }) => {
      const authorization = await app.authorizationForTrace({
        authorization: routeProof,
        traceId: input.traceId,
        tenantId: input.tenantId,
      });
      const protections = await app.resolveViewerProtections({
        projectId: input.projectId,
        userId: actor.id,
        authorization,
      });
      const rows = await app.readSpanResources({
        authorization,
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
    .handle(async ({ app, input, authorization: routeProof, actor }) => {
      const authorization = await app.authorizationForTrace({
        authorization: routeProof,
        traceId: input.traceId,
        tenantId: input.tenantId,
      });
      const protections = await app.resolveViewerProtections({
        projectId: input.projectId,
        userId: actor.id,
        authorization,
      });
      const events = await app.readTraceEvents({
        authorization,
        traceId: input.traceId,
        occurredAtMs: input.occurredAtMs,
      });

      return traceReadMapperPorts.spanProtection.applyDerivedTraceEventProtections(
        events,
        protections,
      );
    })
    .build();

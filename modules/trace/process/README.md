# @langwatch/trace-process

The server half of [trace](../README.md). Traces: ingestion and canonicalisation of spans, the projections built from them, and the reads, renderings and exports other modules ask for.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("trace").withRepositories(traceRepositories).withApi(TraceModule).withTransports(tracesTrpcTransport, sharedTraceTrpcTransport, spansTrpcTransport, exportProgressTrpcTransport, traceEditOverlayTrpcTransport, traceExportRest, traceLegacyRest, tracesRest, trackedEventRest, trackedEventLegacyPathRest, collectorRest, otlpIngestRest).withTransportFacts(…).withEventing(traceProcessingEventing).withEventing(traceProjectMilestonesEventing).withEventing(traceCollectorEvaluationsEventing).withEventing(traceIngestSourceBillingEventing)`, `src/trace.module.ts:30`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`TraceApi`)

Public Trace operations shared by process peers after boot composition.

Peers call these through the token, declared at `../contract/src/trace.api.ts:156`; nothing else in this package is public.
It extends `TraceOtlpIngestApi`.

#### `extractInlineMediaFromEvent`

```typescript
extractInlineMediaFromEvent(input: { event: unknown; projectId: string; ownerKind: "scenario_run"; ownerId: string; purpose: "scenario_event"; }): Promise<{ rewrittenEvent: unknown; refs: readonly { id: string }[] }>;
```

#### `downloadTraceExport`

```typescript
downloadTraceExport(input: TraceExportDownloadInput): Promise<TraceExportDownload>;
```

#### `formatSpansDigest`

```typescript
formatSpansDigest(input: { spans: Span[] }): Promise<string>;
```

#### `renderReadableTrace`

The trace as the LLM-readable span digest, under a token budget. What a reader that is a model gets, where `formatSpansDigest` is unbounded.

```typescript
renderReadableTrace(input: { trace: Trace; maxTokens: number }): Promise<string>;
```

#### `renderThreadTranscript`

A thread as one markdown transcript, traces already ordered and cut: `conversation` reads like the chat view, `steps` lists each turn's tool calls and results. Under `maxTokens` turns shorten before any drops.

```typescript
renderThreadTranscript(input: { threadKey: string; traces: readonly Trace[]; view: ConversationView; maxTokens?: number; }): Promise<string>;
```

#### `renderTraceMessages`

The trace's chat messages as JSON: `"both"` answers `{input, output}`, a one-sided ask answers a bare array. Null when the trace carries no readable conversation at all, which is a different answer from an empty one.

```typescript
renderTraceMessages(input: { trace: Trace; side: TraceMessagesSide }): Promise<string | null>;
```

#### `renderSpanMessages`

One named span's chat messages as JSON, and whether the trace holds it.

```typescript
renderSpanMessages(input: { trace: Trace; spanId: string }): Promise<TraceRenderedSpanMessages>;
```

#### `renderTraceJson`

The whole trace as one JSON object, spans included.

```typescript
renderTraceJson(input: { trace: Trace }): Promise<string>;
```

#### `recordCapturedSpan`

```typescript
recordCapturedSpan(input: RecordCapturedSpanInput): Promise<void>;
```

#### `recordSpan`

Main's `traces.recordSpan`: one raw OTLP span through the ingress command.

```typescript
recordSpan(input: RecordSpanCommandData): Promise<void>;
```

#### `findNormalizedSpansByTraceId`

Main's `getNormalizedSpansByTraceId`: a trace's stored spans, attributes unresolved.

```typescript
findNormalizedSpansByTraceId(input: { tenantId: string; traceId: string; limit?: number; }): Promise<NormalizedSpan[]>;
```

#### `resolveIngestWaitTimeout`

```typescript
resolveIngestWaitTimeout(input: TraceIngestWaitInput): Promise<number>;
```

#### `getEvaluationSpans`

```typescript
getEvaluationSpans(input: EvaluationTraceReadInput): Promise<EvaluationTraceSpan[]>;
```

#### `getEvaluationEvents`

```typescript
getEvaluationEvents(input: EvaluationTraceReadInput): Promise<EvaluationTraceEvent[]>;
```

#### `getById`

The canonical trace record, closed under payload-parity review.

```typescript
getById(input: TraceByIdInput): Promise<TraceRecord>;
```

#### `getFullRecord`

```typescript
getFullRecord(input: TraceFullReadInput): Promise<TraceFullRecord>;
```

#### `getFullThread`

```typescript
getFullThread(input: TraceFullThreadReadInput): Promise<TraceFullRecord[]>;
```

#### `deriveEvents`

```typescript
deriveEvents(input: TraceDerivedEventsInput): Promise<DerivedTraceEvent[]>;
```

#### `buildQueryFieldCatalogue`

The query-language field catalogue an AI composer's prompt is grounded on.

```typescript
buildQueryFieldCatalogue(input: TraceQueryFieldCatalogueInput): Promise<string>;
```

#### `classifyQuery`

```typescript
classifyQuery(input: TraceQueryClassificationInput): TraceQueryClassification;
```

#### `findSummary`

A polling read: absent summaries and disabled projections both read as null.

```typescript
findSummary(input: TraceSummaryLookupInput): Promise<TraceSummaryData | null>;
```

#### `listTraces`

```typescript
listTraces(input: { query: TraceLegacyListInput; protections: unknown; options?: { dateField?: TraceDateField; downloadMode?: boolean; includeSpans?: boolean; resolveBlobs?: boolean; scrollId?: string | null; /** The v1 REST search's compiled query-language filter, ANDed into the read. */ filterWhere?: { sql: string; params: Record<string, unknown> }; /** Refuse above this plan bound instead of clamping to the list bound. */ refuseAbove?: "tracesPageSizeMax" | "tracesDownloadPageSizeMax"; }; }): Promise<TracesForProjectResult>;
```

#### `listTraceSummaries`

The project's latest trace summaries on the `dateField` axis, paged by `scrollId`: no content, spans, evaluations or protections, for a system reader.

```typescript
listTraceSummaries(input: { query: TraceSummaryListQuery; options?: TraceSummaryListOptions; }): Promise<TraceSummaryPage>;
```

#### `findTrace`

```typescript
findTrace(input: { projectId: string; traceId: string; protections: unknown; withEditOverlay?: boolean; }): Promise<Trace | undefined>;
```

#### `getTraceByIdForApiKey`

`GET /api/traces/:traceId` for an API key: the trace, its evaluations and its address.

```typescript
getTraceByIdForApiKey(input: { projectId: string; traceId: string; format: "digest" | "json"; projectSlug: string; principal: PrincipalRef | null; }): Promise<Record<string, unknown>>;
```

#### `getTraceForViewer`

One trace through the viewer's protections; refuses with `TraceNotFoundError`.

```typescript
getTraceForViewer(input: { projectId: string; traceId: string; withEditOverlay?: boolean; viewerUserId: string; }): Promise<Trace>;
```

#### `streamTenantUpdates`

A tenant's `trace_updated` or `discover_updated` pushes, until `signal` aborts.

```typescript
streamTenantUpdates(input: { projectId: string; eventName: "trace_updated" | "discover_updated"; signal?: AbortSignal; }): AsyncIterable<unknown>;
```

#### `readConversationContextForViewer`

One conversation's turns, oldest first, through the viewer's protections.

```typescript
readConversationContextForViewer(input: { projectId: string; conversationId: string; viewerUserId: string; }): Promise<TracesConversationContext>;
```

#### `readSpanDetailForViewer`

One span's detail through the viewer's protections; refuses with `SpanNotFoundError`.

```typescript
readSpanDetailForViewer(input: { projectId: string; traceId: string; spanId: string; occurredAtMs?: number; viewerUserId: string; }): Promise<SpanDetail>;
```

#### `readTraceFacetsForApiKey`

`GET /api/traces/facets` for an API key: the discovery payload or one field's paged values.

```typescript
readTraceFacetsForApiKey(input: { projectId: string; query: TraceFacetsQuery; principal: PrincipalRef | null; }): Promise<TraceFacetsAnswer>;
```

#### `readDiscoverForQuery`

The discover vocabulary, or the facet counts under `query` when one is given.

```typescript
readDiscoverForQuery(input: { projectId: string; timeRange: { from: number; to: number; live?: boolean }; query?: string | null; evalRuns?: Readonly<Record<string, InstantEvalRunReference>>; }): Promise<DiscoverResult>;
```

#### `renameTrace`

Renames a trace after trimming; a name out of bounds refuses with `ValidationError`.

```typescript
renameTrace(input: { projectId: string; traceId: string; newName: string }, by: { id: string }): Promise<{ traceId: string; newName: string }>;
```

#### `getPromptStudioSpan`

The Prompt Studio span through the viewer's protections; refuses with `SpanNotFoundError`.

```typescript
getPromptStudioSpan(input: { projectId: string; spanId: string; viewerUserId: string; }): Promise<unknown>;
```

#### `readTraceEditOverlayForViewer`

The trace's edit overlay as the viewer may see it; `overlay` is null when none exists.

```typescript
readTraceEditOverlayForViewer(input: { projectId: string; traceId: string; viewerUserId: string; }): Promise<{ overlay: TraceEditOverlayDto | null }>;
```

#### `saveTraceEditOverlayAsViewer`

Saves the viewer's patch, carrying over edits their protections withheld from them.

```typescript
saveTraceEditOverlayAsViewer(input: { projectId: string; traceId: string; patch: TraceEditOverlayPatch; viewerUserId: string; }): Promise<TraceEditOverlayDto>;
```

#### `readTracesWithSpans`

```typescript
readTracesWithSpans(input: { projectId: string; traceIds: string[]; protections: unknown; occurredAt?: { from: number; to: number }; withEditOverlay?: boolean; }): Promise<Trace[]>;
```

#### `readTracesWithSpansPreview`

```typescript
readTracesWithSpansPreview(input: { projectId: string; traceIds: string[]; protections: unknown; withEditOverlay?: boolean; }): Promise<Trace[]>;
```

#### `readOrderedSpansForTrace`

```typescript
readOrderedSpansForTrace(input: { projectId: string; traceId: string; protections: unknown; }): Promise<Span[]>;
```

#### `readThreadTraces`

```typescript
readThreadTraces(input: { projectId: string; threadId: string; protections: unknown; }): Promise<Trace[]>;
```

#### `readThreadsTraces`

Every trace of the named threads. `maxTraces` is the ceiling across all of them together: a caller asking for many threads at once sizes it by the threads, because a ceiling below what they hold drops the rest silently.

```typescript
readThreadsTraces(input: { projectId: string; threadIds: string[]; protections: unknown; withEditOverlay?: boolean; maxTraces?: number; }): Promise<Trace[]>;
```

#### `readSampleTraces`

```typescript
readSampleTraces(input: { query: TraceLegacyListInput; protections: unknown; pageSize: number; }): Promise<Trace[]>;
```

#### `readPreconditionSampleTraces`

Main's `traces.getSampleTraces`: up to `expectedResults` sampled traces a check would run on, topped up with ones it would not while fewer than ten pass.

```typescript
readPreconditionSampleTraces(input: TracePreconditionSampleInput): Promise<(Trace & { passesPreconditions: boolean })[]>;
```

#### `readForViewer`

```typescript
readForViewer(input: { projectId: string; userId: string; traceIds: readonly string[]; }): Promise<Trace[]>;
```

#### `resolveViewerProtections`

The caller's read-time redactions for one project, resolved from who they are.

```typescript
resolveViewerProtections(input: { projectId: string; userId: string | null; }): Promise<Protections>;
```

#### `resolveApiKeyProtections`

The same redactions for an API-KEY caller: the public branch of every content category, plus the credential's own `cost:view` grant. A legacy project key (`principal: null`) predates RBAC and sees costs.

```typescript
resolveApiKeyProtections(input: { projectId: string; principal: PrincipalRef | null; }): Promise<Protections>;
```

#### `findExistingTraceIds`

```typescript
findExistingTraceIds(input: { projectId: string; traceIds: readonly string[]; }): Promise<string[]>;
```

#### `findTraceCosts`

Each named trace's latest summary cost inside `occurredAt` (epoch ms); unknown ids absent.

```typescript
findTraceCosts(input: { projectId: string; traceIds: readonly string[]; occurredAt: { from: number; to: number }; }): Promise<TraceCost[]>;
```

#### `loadTraces`

```typescript
loadTraces(input: { userId: string; projectId: string; traceIds: readonly string[]; }): Promise<readonly Trace[]>;
```

#### `writeSuggestion`

```typescript
writeSuggestion(input: { projectId: string; traceId: string; target: TraceSuggestionTarget; text: string; userId: string; }): Promise<void>;
```

#### `recordAnnotation`

```typescript
recordAnnotation(input: TraceAnnotationMarker): Promise<void>;
```

#### `removeAnnotation`

```typescript
removeAnnotation(input: TraceAnnotationMarker): Promise<void>;
```

#### `isCodingAgentShapedSpan`

```typescript
isCodingAgentShapedSpan(span: Span): boolean;
```

#### `enrichSpansFromCodingAgentLogs`

```typescript
enrichSpansFromCodingAgentLogs(input: { projectId: string; traceId: string; spans: Span[]; occurredAtMs?: number; }): Promise<Span[]>;
```

#### `enrichSpanFromCodingAgentLogs`

```typescript
enrichSpanFromCodingAgentLogs(input: { span: Span; modelCallRefs: unknown; logRows: TraceLogRecordDto[]; }): Span;
```

#### `mapCodingAgentSummaryRows`

```typescript
mapCodingAgentSummaryRows(rows: SpanSummaryRow[]): unknown;
```

#### `getLogsByTraceId`

```typescript
getLogsByTraceId(input: { tenantId: string; traceId: string; occurredAtMs?: number; limit?: number; }): Promise< readonly { spanId: string; timeUnixMs: number; body: string; attributes: Record<string, string>; resourceAttributes: Record<string, string>; scopeName: string; scopeVersion: string | null; }[] >;
```

#### `readSpanSummaries`

```typescript
readSpanSummaries(input: { projectId: string; traceId: string; occurredAtMs?: number; }): Promise<SpanSummaryRow[]>;
```

#### `readSpans`

```typescript
readSpans(input: { projectId: string; traceId: string; occurredAtMs?: number; visibilityCutoffMs?: number | null; limit?: number; }): Promise<Span[]>;
```

#### `readSpansPage`

```typescript
readSpansPage(input: { projectId: string; traceId: string; limit: number; offset: number; occurredAtMs?: number; visibilityCutoffMs?: number | null; }): Promise<{ spans: Span[]; total: number }>;
```

#### `readSpansSince`

```typescript
readSpansSince(input: { projectId: string; traceId: string; sinceStartTimeMs: number; occurredAtMs?: number; visibilityCutoffMs?: number | null; }): Promise<Span[]>;
```

#### `findSpan`

```typescript
findSpan(input: { projectId: string; traceId: string; spanId: string; occurredAtMs?: number; visibilityCutoffMs?: number | null; }): Promise<Span | null>;
```

#### `readSpanEvents`

```typescript
readSpanEvents(input: { projectId: string; traceId: string; spanId: string; occurredAtMs?: number; }): Promise<ElasticSearchEvent[]>;
```

#### `readLangwatchSignals`

```typescript
readLangwatchSignals(input: { projectId: string; traceId: string; occurredAtMs?: number; }): Promise<{ spanId: string; signals: SpanLangwatchSignals["signals"] }[]>;
```

#### `readSpanResources`

```typescript
readSpanResources(input: { projectId: string; traceId: string; occurredAtMs?: number; }): Promise<SpanResourceInfo[]>;
```

#### `readTraceEvents`

```typescript
readTraceEvents(input: { projectId: string; traceId: string; occurredAtMs?: number; }): Promise<DerivedTraceEvent[]>;
```

#### `readTraceEventRollups`

```typescript
readTraceEventRollups(input: { projectId: string; traceIds: string[]; timeRange: { from: number; to: number }; }): Promise<Record<string, TraceEventRollup>>;
```

#### `readSpanTreePage`

```typescript
readSpanTreePage(input: SpanTreeInput): Promise<SpanTreePage>;
```

#### `readSpanTreeDelta`

```typescript
readSpanTreeDelta(input: SpanTreeDeltaInput): Promise<SpanTreeNode[]>;
```

#### `readModelUsageStats`

```typescript
readModelUsageStats(input: { projectId: string; fromMs: number; limit: number; }): Promise<ModelUsageStatsRow[]>;
```

#### `findModelSpend`

The project's most-spent models in the window, most spent first, at most `limit`.

```typescript
findModelSpend(input: { projectId: string; window: TraceModelSpendWindow; limit: number; }): Promise<TraceModelSpend[]>;
```

#### `getSpendSummary`

The project's deduped spend and token totals in the window.

```typescript
getSpendSummary(input: { projectId: string; window: TraceModelSpendWindow; }): Promise<TraceSpendSummary>;
```

#### `findTopModelsByRequests`

The project's most-used models by trace count in the window, most first, at most `limit`.

```typescript
findTopModelsByRequests(input: { projectId: string; window: TraceModelSpendWindow; limit: number; }): Promise<TraceModelRequests[]>;
```

#### `findDailySpend`

The project's spend per UTC day in the window, oldest first.

```typescript
findDailySpend(input: { projectId: string; window: TraceModelSpendWindow; }): Promise<TraceDailySpend[]>;
```

#### `findSpendByAttributeValue`

Per attribute value in `values`, the project's deduped spend and trace count in the window.

```typescript
findSpendByAttributeValue(input: { projectId: string; attributeKey: string; values: string[]; window: TraceModelSpendWindow; }): Promise<TraceAttributeValueSpend[]>;
```

#### `findAttributeUsageBuckets`

The project's traces carrying the attribute (or one of `values`), per value, model and day.

```typescript
findAttributeUsageBuckets(input: { projectId: string; attributeKey: string; window: TraceModelSpendWindow; values?: string[]; }): Promise<TraceAttributeUsageBucket[]>;
```

#### `findAttributedTraces`

The project's newest traces carrying the attribute, at most `limit`; `model` is the first.

```typescript
findAttributedTraces(input: { projectId: string; attributeKey: string; window: TraceModelSpendWindow; values?: string[]; model?: string; limit: number; }): Promise<TraceAttributedTrace[]>;
```

#### `getAttributedSpendComparison`

Current and previous window spend of the traces matching every attribute; distinct actors.

```typescript
getAttributedSpendComparison(input: { projectId: string; matches: readonly TraceAttributeMatch[]; actorKey: string; previousStartMs: number; currentStartMs: number; endMs: number; }): Promise<TraceAttributedSpendComparison>;
```

#### `findAttributedSpendByValue`

Spend per non-empty `valueKey` value of the matching traces, sorted and paged in the store.

```typescript
findAttributedSpendByValue(input: { projectId: string; matches: readonly TraceAttributeMatch[]; valueKey: string; window: TraceModelSpendWindow; sortBy: TraceAttributedSpendSort; sortDirection: "asc" | "desc"; limit: number; offset: number; }): Promise<TraceAttributedValueSpend[]>;
```

#### `findAttributedSpendComparisonByValue`

Per non-empty `valueKey` value, spend split at `currentStartMs`; unsorted.

```typescript
findAttributedSpendComparisonByValue(input: { projectId: string; matches: readonly TraceAttributeMatch[]; valueKey: string; previousStartMs: number; currentStartMs: number; endMs: number; }): Promise<TraceAttributedValueComparison[]>;
```

#### `findSpendByProjectAndValue`

Spend per (project, `valueKey` value) across one organisation's projects; unsorted.

```typescript
findSpendByProjectAndValue(input: { projectIds: readonly string[]; valueKey: string; window: TraceModelSpendWindow; }): Promise<TraceProjectValueSpend[]>;
```

#### `findDailyAttributedSpend`

Spend of the matching traces per UTC day and group value, oldest day first.

```typescript
findDailyAttributedSpend(input: { projectId: string; matches: readonly TraceAttributeMatch[]; groupBy: TraceDailySpendGroup; window: TraceModelSpendWindow; }): Promise<TraceDailyGroupSpend[]>;
```

#### `countAttributedTracesByValue`

Matching traces since `sinceMs`, counted per `valueKey` value among `values`.

```typescript
countAttributedTracesByValue(input: { projectId: string; matches: readonly TraceAttributeMatch[]; valueKey: string; values: readonly string[]; sinceMs: number; }): Promise<{ value: string; count: number }[]>;
```

#### `findAttributedTracesBefore`

The newest matching traces before `beforeMs`, at most `limit`, with the asked attributes.

```typescript
findAttributedTracesBefore(input: { projectId: string; matches: readonly TraceAttributeMatch[]; attributeKeys: readonly string[]; beforeMs: number; limit: number; }): Promise<TraceAttributedTraceDetail[]>;
```

#### `getAttributedTraceRecency`

Matching trace counts since each of `countSinceMs`, and their newest occurrence ever.

```typescript
getAttributedTraceRecency(input: { projectId: string; matches: readonly TraceAttributeMatch[]; countSinceMs: readonly number[]; }): Promise<TraceAttributedRecency>;
```

#### `readRecentSpansByModels`

```typescript
readRecentSpansByModels(input: { projectId: string; models: string[]; fromMs: number; perModelLimit: number; limit: number; }): Promise<ModelSpanSampleRow[]>;
```

#### `readEvaluations`

```typescript
readEvaluations(input: { projectId: string; traceIds: string[]; protections: unknown; }): Promise<Record<string, unknown[]>>;
```

#### `readTopicCounts`

```typescript
readTopicCounts(input: TraceLegacyListInput): Promise<unknown>;
```

#### `readCustomersAndLabels`

```typescript
readCustomersAndLabels(input: TraceLegacyListInput): Promise<unknown>;
```

#### `translateTraceFilter`

The trace query language's free-text filter, compiled to a parameterized ClickHouse WHERE fragment. Null for an empty query; throws `FilterParseError` on invalid syntax.

```typescript
translateTraceFilter(input: { query: string; tenantId: string; timeRange: { from: number; to: number }; /** The Instant Eval runs registered for the query's `eval` chips. */ evalRuns?: readonly ResolvedInstantEvalRun[]; }): { sql: string; params: Record<string, unknown> } | null;
```

#### `translateLegacyFilters`

A legacy `filters` document compiled to parameterized ClickHouse conditions over `trace_summaries ts`. Trace owns the grammar because it owns the tables.

```typescript
translateLegacyFilters(input: { filters: Readonly<Record<string, unknown>>; window?: { startDate?: number; endDate?: number }; }): { conditions: string[]; params: Record<string, unknown>; hasUnsupportedFilters: boolean };
```

#### `compileExplorerTraceFilter`

The Explorer's own filter: the query compiled, hidden origins left out unless the query (or `originNamed`) names one; `dateField` refuses a span/event clause on the `updated` axis.

```typescript
compileExplorerTraceFilter(input: { query: string; tenantId: string; timeRange: { from: number; to: number }; evalRuns?: readonly ResolvedInstantEvalRun[]; originNamed?: boolean; dateField?: TraceDateField; }): { sql: string; params: Record<string, unknown> };
```

#### `compileLangWatchQLTraceFilter`

The filter compiled against the LangWatchQL trace view, for a statement a caller runs; throws `FilterParseError` on syntax the language cannot read.

```typescript
compileLangWatchQLTraceFilter(input: { filter: string }): LangWatchQLTraceFilter;
```

#### `findTraceIdsForFilter`

The trace ids a filter selects, newest first and capped: the predicate the Explorer's table shows. What an Instant Eval run started from the Explorer judges when its own dialect cannot compile the filter.

```typescript
findTraceIdsForFilter(input: { projectId: string; filter: string; window: { from: number; to: number }; limit: number; }): Promise<readonly string[]>;
```

#### `extractTraceFreeTextTerms`

The query's positive bare-word terms, for a content (log-body) search.

```typescript
extractTraceFreeTextTerms(query: string): string[];
```

#### `readFieldNames`

```typescript
readFieldNames(input: { projectId: string; startDate: number; endDate: number; }): Promise<unknown>;
```

#### `findPromptStudioSpan`

```typescript
findPromptStudioSpan(input: { projectId: string; spanId: string; protections: unknown; }): Promise<unknown>;
```

#### `readTraceList`

```typescript
readTraceList(params: { tenantId: string; timeRange: { from: number; to: number }; sort: { columnId: string; direction: "asc" | "desc" }; page?: number; pageSize: number; cursor?: { sortValue: number; traceId: string }; filterWhere?: { sql: string; params: Record<string, unknown> }; visibilityCutoffMs?: number | null; }): Promise<TraceListPage>;
```

#### `readSessionGroups`

One page of the Sessions lens through the viewer's protections: content redacted and spend gated, with `codingAgent` left null for coding-agent, which serves the lens, to fill and gate.

```typescript
readSessionGroups(input: TraceSessionGroupsInput & { protections: Protections }): Promise<TracesSessionsPage>;
```

#### `readFilteredFacets`

The sidebar's facets under the active query: descriptors counted in the window the list reads, each facet exempt from its own terms (ADR-139).

```typescript
readFilteredFacets(input: { projectId: string; timeRange: { from: number; to: number; live?: boolean }; query: string; evalRuns?: readonly ResolvedInstantEvalRun[]; }): Promise<unknown>;
```

#### `readNewCount`

```typescript
readNewCount(params: unknown): Promise<number>;
```

#### `readSuggestions`

```typescript
readSuggestions(params: unknown): Promise<string[]>;
```

#### `readDiscover`

```typescript
readDiscover(params: { tenantId: string; timeRange: { from: number; to: number; live?: boolean }; }): Promise<DiscoverResult>;
```

#### `readFacetValues`

```typescript
readFacetValues(params: { tenantId: string; timeRange: { from: number; to: number }; facetKey: string; prefix?: string; limit: number; offset: number; }): Promise<FacetValuesResult>;
```

#### `readTraceSummary`

```typescript
readTraceSummary(input: { projectId: string; traceId: string; occurredAtMs?: number; visibilityCutoffMs?: number | null; full?: boolean; }): Promise<unknown>;
```

#### `isTraceWindowRedacted`

```typescript
isTraceWindowRedacted(input: { projectId: string; traceId: string; visibilityCutoffMs: number | null | undefined; }): Promise<boolean>;
```

#### `readTraceLogRecords`

```typescript
readTraceLogRecords(input: { projectId: string; traceId: string; occurredAtMs?: number; limit?: number; }): Promise<TraceLogRecordDto[]>;
```

#### `changeTraceName`

```typescript
changeTraceName(input: { projectId: string; traceId: string; newName: string; occurredAt?: number }, by: { id: string }): Promise<unknown>;
```

#### `findTraceEditOverlay`

```typescript
findTraceEditOverlay(input: { projectId: string; traceId: string; }): Promise<TraceEditOverlayDto | null>;
```

#### `saveTraceEditOverlay`

```typescript
saveTraceEditOverlay(input: { projectId: string; traceId: string; patch: TraceEditOverlayPatch }, by: { id: string }): Promise<TraceEditOverlayDto>;
```

#### `deleteTraceEditOverlay`

```typescript
deleteTraceEditOverlay(input: { projectId: string; traceId: string }): Promise<void>;
```

#### `readEvaluationRuns`

```typescript
readEvaluationRuns(input: { tenantId: string; traceId: string }): Promise<unknown>;
```

#### `readCodingAgentTranscript`

The transcript through the viewer's own protections; `codingAgents.transcript` reads it.

```typescript
readCodingAgentTranscript(input: { projectId: string; traceId: string; occurredAtMs?: number | undefined; viewerUserId: string; }): Promise<unknown>;
```

#### `readTraceTranscript`

Main's `GET /api/traces/:traceId/transcript`: the key's protections, the trace by id or prefix, then its transcript.

```typescript
readTraceTranscript(input: { projectId: string; traceId: string; principal: PrincipalRef | null; }): Promise<unknown>;
```

#### `updateTraceMetadata`

Main's `PATCH /api/traces/:traceId/metadata`: one synthetic span carrying the metadata, recorded through the collector's ingress command. Refuses by name where no recorder is.

```typescript
updateTraceMetadata(input: { projectId: string; traceId: string; metadata: TraceMetadataUpdate; }): Promise<void>;
```

#### `streamExportProgress`

One export's progress frames from the tenant broadcast, ending at `done` or `error`.

```typescript
streamExportProgress(input: { projectId: string; exportId: string; signal?: AbortSignal | undefined; }): AsyncGenerator<ExportProgressEvent>;
```

#### `resolveShareForViewer`

```typescript
resolveShareForViewer(input: { token: string; viewer: unknown; viewerKey?: string; }): Promise<unknown>;
```

#### `readCachedSharePayload`

```typescript
readCachedSharePayload(input: { token: string; protections: unknown }): Promise<unknown>;
```

#### `writeCachedSharePayload`

```typescript
writeCachedSharePayload(input: { token: string; protections: unknown; payload: unknown; }): Promise<void>;
```

#### `findProject`

```typescript
findProject(projectId: string): Promise<unknown>;
```

#### `getSharedTrace`

The anonymous share page's whole payload for one token (port of main's `sharedTrace.get`, ADR-057). `viewerUserId` is the signed-in caller, if any.

```typescript
getSharedTrace(input: { token: string; viewerUserId: string | null; clientIp: string | null; userAgent: string | null; }): Promise<SharedTraceDto>;
```

#### `findExplorerEvalRuns`

The runs a query's `eval` chips claim, checked against the project and dated for the compiler. A claim the project does not own is dropped, so the chip behind it stays pending and selects no rows.

```typescript
findExplorerEvalRuns(input: { projectId: string; evalRuns?: Readonly<Record<string, InstantEvalRunReference>>; }): Promise<readonly ResolvedInstantEvalRun[]>;
```

#### `platformUrl`

The platform's own address for one trace resource, built from the project's slug and the path the caller already resolved.

```typescript
platformUrl(input: { projectSlug: string; path: string }): string;
```

#### `countUsage`

The usage report's figures (ADR-156, section 10).

```typescript
countUsage(input: { projectIds: readonly string[]; since?: number }): Promise<TraceUsageCount>;
```

#### `classifyClaudeCall`

```typescript
classifyClaudeCall(input: ClassifyClaudeCallInput): ClassifyClaudeCallResult;
```

#### `deriveClaudeResponseContent`

```typescript
deriveClaudeResponseContent(input: DeriveClaudeResponseContentInput): DeriveClaudeResponseContentResult;
```

#### `canonicalizeLogRecord`

Lifts a log record's attributes into Trace's canonical names.

```typescript
canonicalizeLogRecord(input: CanonicalizeLogRecordInput): CanonicalizeLogRecordResult;
```

#### `canonicalizeSpanAttributes`

Lifts a decoded span's attributes and events into Trace's canonical names, as ingest does.

```typescript
canonicalizeSpanAttributes(input: CanonicalizeSpanAttributesInput): CanonicalizeSpanAttributesResult;
```

#### `extractLogRecordIO`

A log record's input and output, each cut to Trace's 64 KiB projection preview.

```typescript
extractLogRecordIO(input: LogRecordReceivedEventData): { input: string | null; output: string | null; truncated: boolean; };
```

#### `recordLogContributions`

Sends trace_processing's recordLogContribution batch; refuses where none is registered.

```typescript
recordLogContributions(input: readonly LogTraceContribution[]): Promise<void>;
```

#### `recordMetricCorrelations`

Sends trace_processing's recordMetricCorrelation batch; refuses where none is registered.

```typescript
recordMetricCorrelations(input: readonly RecordMetricCorrelationCommandData[]): Promise<void>;
```

#### `assignTopic`

Sends trace_processing's assignTopic command; refuses where this process registered none.

```typescript
assignTopic(input: AssignTopicCommandData): Promise<void>;
```

#### `deriveScenarioRoleMetrics`

```typescript
deriveScenarioRoleMetrics(input: ScenarioRoleMetricsInput): Promise<ScenarioRoleMetrics>;
```

#### `matchesFilterQuery`

A saved query against one folded trace, in memory; fails closed on anything it cannot read.

```typescript
matchesFilterQuery(input: { query: string; foldState: TraceSummaryData; evaluations: TraceQueryEvaluationRun[] | null; events: DerivedTraceEvent[] | null; }): boolean;
```

#### `matchesTraceFilters`

A trigger's legacy trace filters against one folded trace; evaluation fields fail closed.

```typescript
matchesTraceFilters(input: { filters: Readonly<Record<string, unknown>>; foldState: TraceSummaryData; events: DerivedTraceEvent[] | null; }): boolean;
```

#### `readTopicClusteringCounts`

```typescript
readTopicClusteringCounts(input: { projectId: string }): Promise<TraceTopicClusteringCounts>;
```

#### `readTopicClusteringPage`

```typescript
readTopicClusteringPage(input: TraceTopicClusteringPageInput): Promise<TraceTopicClusteringPage>;
```

#### `countTracesByProjects`

This UTC billing month's distinct traces per project; refuses a foreign project.

```typescript
countTracesByProjects(input: { organizationId: string; projectIds: string[]; }): Promise<{ projectId: string; count: number }[]>;
```

#### `countTracesInLastDay`

The project's distinct traces over the last 24 hours.

```typescript
countTracesInLastDay(input: { projectId: string }): Promise<number>;
```

#### `hasTraceWithAttribute`

Whether any trace carrying `attribute` landed for the project at or after `sinceMs`.

```typescript
hasTraceWithAttribute(input: { projectId: string; sinceMs: number; attribute: TraceAttributeMatch; }): Promise<boolean>;
```

#### `findTraceCountsByAttribute`

Rows carrying `attribute` since `sinceMs`, counted per `groupByKey` value, most first.

```typescript
findTraceCountsByAttribute(input: { projectId: string; sinceMs: number; attribute: TraceAttributeMatch; groupByKey: string; }): Promise<{ value: string; count: number }[]>;
```

## REST transport

### `collectorRest`

|             |                                        |
| ----------- | -------------------------------------- |
| Declared at | `src/transport/collector.rest.ts:335`  |
| Base URL    | none: each route's path is its address |
| Addressing  | literal                                |
| Credential  | project                                |

#### `POST /api/collector` · `collectTrace`

Public: Trace collection API key resolved in-handler, so the refusal carries the credential chain's own body; the route itself is gated on traces:create. Hidden from the OpenAPI document. Declared at `src/transport/collector.rest.ts:341`.

Answers at `/api/collector`.

```typescript
// Rawbody: "text" (inline, src/transport/collector.rest.ts:343)
// Response: "protocol" (inline, src/transport/collector.rest.ts:351)
```

### `otlpIngestRest`

|             |                                         |
| ----------- | --------------------------------------- |
| Declared at | `src/transport/otlp-ingest.rest.ts:328` |
| Base URL    | none: each route's path is its address  |
| Addressing  | literal                                 |
| Credential  | project                                 |

#### `POST /api/otel/v1/traces` · `ingestOtlpTraces`

Public: OTLP ingestion API key resolved in-handler. Hidden from the OpenAPI document. Declared at `src/transport/otlp-ingest.rest.ts:333`.

Answers at `/api/otel/v1/traces`.

```typescript
// Rawbody: "bytes" (inline, src/transport/otlp-ingest.rest.ts:334)
// Response: "protocol" (inline, src/transport/otlp-ingest.rest.ts:337)
```

#### `POST /:otlpBase{.+}/v1/traces` · `ingestOtlpTracesAlias`

Public: OTLP ingestion API key resolved in-handler. Hidden from the OpenAPI document. Declared at `src/transport/otlp-ingest.rest.ts:355`.

Answers at `/:otlpBase{.+}/v1/traces`.

```typescript
type Params = z.infer<typeof otlpTraceAliasParamsSchema>; // ../contract/src/otlp-ingest.rest.ts:11
// Rawbody: "bytes" (inline, src/transport/otlp-ingest.rest.ts:357)
// Response: "protocol" (inline, src/transport/otlp-ingest.rest.ts:360)
```

#### `POST /:otlpBase{.+}/v1/traces/` · `ingestOtlpTracesAliasSlash`

Public: OTLP ingestion API key resolved in-handler. Hidden from the OpenAPI document. Declared at `src/transport/otlp-ingest.rest.ts:370`.

Answers at `/:otlpBase{.+}/v1/traces/`.

```typescript
type Params = z.infer<typeof otlpTraceAliasParamsSchema>; // ../contract/src/otlp-ingest.rest.ts:11
// Rawbody: "bytes" (inline, src/transport/otlp-ingest.rest.ts:372)
// Response: "protocol" (inline, src/transport/otlp-ingest.rest.ts:375)
```

#### `POST /v1/traces` · `ingestOtlpTracesRootV1`

Public: OTLP ingestion API key resolved in-handler. Hidden from the OpenAPI document. Declared at `src/transport/otlp-ingest.rest.ts:385`.

Answers at `/v1/traces`.

```typescript
// Rawbody: "bytes" (inline, src/transport/otlp-ingest.rest.ts:386)
// Response: "protocol" (inline, src/transport/otlp-ingest.rest.ts:389)
```

#### `POST /v1/traces/` · `ingestOtlpTracesRootV1Slash`

Public: OTLP ingestion API key resolved in-handler. Hidden from the OpenAPI document. Declared at `src/transport/otlp-ingest.rest.ts:399`.

Answers at `/v1/traces/`.

```typescript
// Rawbody: "bytes" (inline, src/transport/otlp-ingest.rest.ts:400)
// Response: "protocol" (inline, src/transport/otlp-ingest.rest.ts:403)
```

### `traceExportRest`

|             |                                         |
| ----------- | --------------------------------------- |
| Declared at | `src/transport/trace-export.rest.ts:25` |
| Base URL    | none: each route's path is its address  |
| Addressing  | literal                                 |
| Credential  | browser                                 |

#### `POST /api/export/traces/download` · `downloadTraceExport`

Permission `traces:view`. Hidden from the OpenAPI document. Declared at `src/transport/trace-export.rest.ts:30`.

Answers at `/api/export/traces/download`.

```typescript
type Body = z.infer<typeof traceExportRequestSchema>; // ../contract/src/trace-export.vocabulary.ts:76
// Response: "bytes" (inline, src/transport/trace-export.rest.ts:34)
```

### `traceLegacyRest`

|             |                                          |
| ----------- | ---------------------------------------- |
| Declared at | `src/transport/trace-legacy.rest.ts:406` |
| Base URL    | none: each route's path is its address   |
| Addressing  | literal                                  |
| Credential  | project                                  |

#### `GET /api/trace/:id` · `getLegacyTrace`

Returns single trace details based on the ID supplied

Permission `traces:view`. Declared at `src/transport/trace-legacy.rest.ts:413`.

Answers at `/api/trace/:id`.

```typescript
type Params = z.infer<typeof traceLegacyIdParamsSchema>; // ../contract/src/trace-rest.schemas.ts:134
type Query = z.infer<typeof traceFormatQuerySchema>; // ../contract/src/trace-rest.schemas.ts:196
// Response: "protocol" (inline, src/transport/trace-legacy.rest.ts:418)
```

#### `POST /api/trace/:id/share` · `shareLegacyTrace`

Returns a public path for a trace

Permission `traces:share`. Declared at `src/transport/trace-legacy.rest.ts:438`.

Answers at `/api/trace/:id/share`.

```typescript
type Params = z.infer<typeof traceLegacyIdParamsSchema>; // ../contract/src/trace-rest.schemas.ts:134
// Response: "protocol" (inline, src/transport/trace-legacy.rest.ts:441)
```

#### `POST /api/trace/:id/unshare` · `unshareLegacyTrace`

Deletes a public path for a trace

Permission `traces:share`. Declared at `src/transport/trace-legacy.rest.ts:457`.

Answers at `/api/trace/:id/unshare`.

```typescript
type Params = z.infer<typeof traceLegacyIdParamsSchema>; // ../contract/src/trace-rest.schemas.ts:134
// Response: "protocol" (inline, src/transport/trace-legacy.rest.ts:460)
```

#### `POST /api/trace/search` · `searchLegacyTraces`

Search traces

Permission `traces:view`. Declared at `src/transport/trace-legacy.rest.ts:480`.

Answers at `/api/trace/search`.

```typescript
// Rawbody: "text" (inline, src/transport/trace-legacy.rest.ts:481)
// Response: "protocol" (inline, src/transport/trace-legacy.rest.ts:485)
```

#### `GET /api/thread/:threadId` · `getLegacyThread`

Permission `traces:view`. Hidden from the OpenAPI document. Declared at `src/transport/trace-legacy.rest.ts:508`.

Answers at `/api/thread/:threadId`.

```typescript
type Params = z.infer<typeof traceLegacyThreadParamsSchema>; // ../contract/src/trace-rest.schemas.ts:139
// Response: "protocol" (inline, src/transport/trace-legacy.rest.ts:512)
```

### `router`

|             |                                      |
| ----------- | ------------------------------------ |
| Declared at | `src/transport/traces.rest.ts:308`   |
| Base URL    | `/api/traces`, twin `/api/v1/traces` |
| Addressing  | dated                                |
| Credential  | project                              |
| Versions    | `2026-08-07`                         |

#### `POST /search` · `searchTraces`

Search traces for a project

Permission `traces:view`. Declared at `src/transport/traces.rest.ts:312`.

Answers at `/api/traces/search`, `/api/v1/traces/search`; also, undocumented, `/api/traces/2026-08-07/search`, `/api/v1/traces/2026-08-07/search`, `/api/traces/latest/search`, `/api/v1/traces/latest/search`.

```typescript
type Body = z.infer<typeof traceSearchBodySchema>; // ../contract/src/trace-rest.schemas.ts:108
// Response: "bytes" (inline, src/transport/traces.rest.ts:315)
```

#### `GET /facets` · `getTraceFacets`

Discover what the trace filter fields hold

Permission `traces:view`. Declared at `src/transport/traces.rest.ts:337`.

Answers at `/api/traces/facets`, `/api/v1/traces/facets`; also, undocumented, `/api/traces/2026-08-07/facets`, `/api/v1/traces/2026-08-07/facets`, `/api/traces/latest/facets`, `/api/v1/traces/latest/facets`.

```typescript
type Query = z.infer<typeof traceFacetsQuerySchema>; // ../contract/src/trace-rest.schemas.ts:329
type Response = z.infer<typeof traceFacetsResponseSchema>; // ../contract/src/trace-rest.schemas.ts:351
```

#### `GET /:traceId/transcript` · `getTraceTranscript`

Derived coding-agent transcript for a trace: what the agent did, in order, with per-call token and cost economics. Empty entries for traces without coding-agent content.

Permission `traces:view`. Declared at `src/transport/traces.rest.ts:369`.

Answers at `/api/traces/:traceId/transcript`, `/api/v1/traces/:traceId/transcript`; also, undocumented, `/api/traces/2026-08-07/:traceId/transcript`, `/api/v1/traces/2026-08-07/:traceId/transcript`, `/api/traces/latest/:traceId/transcript`, `/api/v1/traces/latest/:traceId/transcript`.

```typescript
type Params = z.infer<typeof traceIdParamsSchema>; // ../contract/src/trace-rest.schemas.ts:187
type Response = z.infer<typeof transcriptRestResponseSchema>; // ../contract/src/trace-rest.schemas.ts:245
```

#### `PATCH /:traceId/metadata` · `updateTraceMetadata`

Update metadata on a trace after creation. Inserts a synthetic span carrying the new attributes through the standard ingestion pipeline. New keys are added, existing keys are updated, missing keys are preserved. Labels replace entirely.

Permission `traces:update`. Declared at `src/transport/traces.rest.ts:408`.

Answers at `/api/traces/:traceId/metadata`, `/api/v1/traces/:traceId/metadata`; also, undocumented, `/api/traces/2026-08-07/:traceId/metadata`, `/api/v1/traces/2026-08-07/:traceId/metadata`, `/api/traces/latest/:traceId/metadata`, `/api/v1/traces/latest/:traceId/metadata`.

```typescript
type Params = z.infer<typeof traceIdParamsSchema>; // ../contract/src/trace-rest.schemas.ts:187
type Body = z.infer<typeof traceMetadataBodySchema>; // ../contract/src/trace-rest.schemas.ts:225
type Response = z.infer<typeof traceMetadataResponseSchema>; // ../contract/src/trace-rest.schemas.ts:204
```

#### `GET /:traceId` · `getTrace`

Get a single trace by ID.

Permission `traces:view`. Declared at `src/transport/traces.rest.ts:432`.

Answers at `/api/traces/:traceId`, `/api/v1/traces/:traceId`; also, undocumented, `/api/traces/2026-08-07/:traceId`, `/api/v1/traces/2026-08-07/:traceId`, `/api/traces/latest/:traceId`, `/api/v1/traces/latest/:traceId`.

```typescript
type Params = z.infer<typeof traceIdParamsSchema>; // ../contract/src/trace-rest.schemas.ts:187
type Query = z.infer<typeof traceFormatQuerySchema>; // ../contract/src/trace-rest.schemas.ts:196
type Response = z.infer<typeof traceDetailResponseSchema>; // ../contract/src/trace-rest.schemas.ts:105
```

### `trackedEventRest`

|             |                                          |
| ----------- | ---------------------------------------- |
| Declared at | `src/transport/tracked-event.rest.ts:48` |
| Base URL    | `/api/events`, twin `/api/v1/events`     |
| Addressing  | dated                                    |
| Credential  | project                                  |
| Versions    | `2026-08-07`                             |

#### `POST /track` · `trackEvent`

Record a user event

Permission `traces:create`. Declared at `src/transport/tracked-event.rest.ts:53`.

Answers at `/api/events/track`, `/api/v1/events/track`; also, undocumented, `/api/events/2026-08-07/track`, `/api/v1/events/2026-08-07/track`, `/api/events/latest/track`, `/api/v1/events/latest/track`.

```typescript
// Rawbody: "text" (inline, src/transport/tracked-event.rest.ts:54)
type Response = z.infer<typeof trackEventResponseSchema>; // ../contract/src/trace-rest.schemas.ts:227
```

### `trackedEventLegacyPathRest`

|             |                                          |
| ----------- | ---------------------------------------- |
| Declared at | `src/transport/tracked-event.rest.ts:87` |
| Base URL    | none: each route's path is its address   |
| Addressing  | literal                                  |
| Credential  | project                                  |

#### `POST /api/track_event` · `trackEventLegacyAlias`

Track an event (legacy path)

Permission `traces:create`. Declared at `src/transport/tracked-event.rest.ts:92`.

Answers at `/api/track_event`.

```typescript
// Rawbody: "text" (inline, src/transport/tracked-event.rest.ts:93)
type Response = z.infer<typeof trackEventResponseSchema>; // ../contract/src/trace-rest.schemas.ts:227
```

## tRPC transport

### `export`

Contract `../contract/src/export-progress.trpc.ts:20`, router `src/transport/export-progress.trpc.ts:6`.

| Procedure                            | Kind         | Gate                        | Input                       | Output                      |
| ------------------------------------ | ------------ | --------------------------- | --------------------------- | --------------------------- |
| `export.onExportProgress`            | subscription | Permission `traces:view`    | `exportProgressInputSchema` | `exportProgressEventSchema` |
| `export.onScenarioRunExportProgress` | subscription | Permission `scenarios:view` | `exportProgressInputSchema` | `exportProgressEventSchema` |

### `sharedTrace`

Contract `../contract/src/traces.trpc.ts:600`, router `src/transport/shared-trace.trpc.ts:30`.

| Procedure         | Kind  | Gate                                                                                                                                                | Input                       | Output                 |
| ----------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ---------------------- |
| `sharedTrace.get` | query | Public: the share token in the input is the whole authorization; audience, expiry, view cap and the kill switch are checked on every read (ADR-057) | `sharedTraceGetInputSchema` | `sharedTraceDtoSchema` |

### `spans`

Contract `../contract/src/traces.trpc.ts:609`, router `src/transport/spans.trpc.ts:10`.

| Procedure                  | Kind  | Gate                     | Input              | Output                   |
| -------------------------- | ----- | ------------------------ | ------------------ | ------------------------ |
| `spans.getAllForTrace`     | query | Permission `traces:view` | `traceScopeSchema` | `spansForTraceSchema`    |
| `spans.getForPromptStudio` | query | Permission `traces:view` | `spanScopeSchema`  | `promptStudioSpanSchema` |

### `traceEditOverlay`

Contract `../contract/src/trace-edit-overlay.trpc.ts:19`, router `src/transport/trace-edit-overlay.trpc.ts:12`.

| Procedure                       | Kind     | Gate                            | Input               | Output                         |
| ------------------------------- | -------- | ------------------------------- | ------------------- | ------------------------------ |
| `traceEditOverlay.getByTraceId` | query    | Permission `traces:view`        | `traceScopeSchema`  | `traceEditOverlayOrNullSchema` |
| `traceEditOverlay.upsert`       | mutation | Permission `annotations:update` | `upsertInputSchema` | `traceEditOverlayDtoSchema`    |
| `traceEditOverlay.delete`       | mutation | Permission `annotations:update` | `traceScopeSchema`  | –                              |

### `traces`

Contract `../contract/src/traces.trpc.ts:159`, router `src/transport/traces.trpc.ts:44`.

| Procedure                              | Kind         | Gate                       | Input                               | Output                             |
| -------------------------------------- | ------------ | -------------------------- | ----------------------------------- | ---------------------------------- |
| `traces.getAllForProject`              | query        | Permission `traces:view`   | `traceListInputSchema`              | `tracesForProjectResultSchema`     |
| `traces.getById`                       | query        | Permission `traces:view`   | inline                              | `traceSchema`                      |
| `traces.getEvaluations`                | query        | Permission `traces:view`   | `traceScopeSchema`                  | inline                             |
| `traces.getEvaluationsMultiple`        | query        | Permission `traces:view`   | inline                              | inline                             |
| `traces.getCustomersAndLabels`         | query        | Permission `traces:view`   | `traceFilterInputSchema`            | `customersAndLabelsResultSchema`   |
| `traces.getTracesByThreadId`           | query        | Permission `traces:view`   | inline                              | inline                             |
| `traces.getTracesWithSpans`            | query        | Permission `traces:view`   | inline                              | inline                             |
| `traces.getFormattedSpansDigest`       | query        | Permission `traces:view`   | inline                              | inline                             |
| `traces.getTracesWithSpansByThreadIds` | query        | Permission `traces:view`   | inline                              | inline                             |
| `traces.getSampleTracesDataset`        | query        | Permission `traces:view`   | inline                              | inline                             |
| `traces.getSampleTraces`               | query        | Permission `traces:view`   | inline                              | inline                             |
| `traces.getFieldNames`                 | query        | Permission `traces:view`   | inline                              | `distinctFieldNamesResultSchema`   |
| `traces.getFieldRedactionStatus`       | query        | Permission `project:view`  | inline                              | `tracesFieldRedactionStatusSchema` |
| `traces.getAllForDownload`             | mutation     | Permission `traces:view`   | inline                              | `tracesForProjectResultSchema`     |
| `traces.onTraceUpdate`                 | subscription | Permission `traces:view`   | inline                              | inline                             |
| `traces.list`                          | query        | Permission `traces:view`   | inline                              | `tracesListPageSchema`             |
| `traces.listEvents`                    | query        | Permission `traces:view`   | inline                              | `tracesListEventsSchema`           |
| `traces.newCount`                      | query        | Permission `traces:view`   | inline                              | `tracesNewCountSchema`             |
| `traces.suggest`                       | query        | Permission `traces:view`   | inline                              | `tracesSuggestSchema`              |
| `traces.conversationContext`           | query        | Permission `traces:view`   | inline                              | `tracesConversationContextSchema`  |
| `traces.discover`                      | query        | Permission `traces:view`   | inline                              | `discoverResultSchema`             |
| `traces.facets`                        | query        | Permission `traces:view`   | inline                              | `discoverResultSchema`             |
| `traces.onDiscoverUpdate`              | subscription | Permission `traces:view`   | inline                              | inline                             |
| `traces.facetValues`                   | query        | Permission `traces:view`   | inline                              | `facetValuesResultSchema`          |
| `traces.aiQuery`                       | mutation     | Permission `traces:view`   | inline                              | `aiQueryResultSchema`              |
| `traces.aiAction`                      | mutation     | Permission `traces:view`   | inline                              | `aiActionResultSchema`             |
| `traces.routeSearch`                   | mutation     | Permission `traces:view`   | `routeSearchInputSchema`            | `routeSearchResultSchema`          |
| `traces.header`                        | query        | Permission `traces:view`   | inline                              | `traceHeaderSchema`                |
| `traces.changeName`                    | mutation     | Permission `traces:update` | inline                              | `tracesChangedNameSchema`          |
| `traces.changeMetadata`                | mutation     | Permission `traces:update` | inline                              | `traceMetadataResponseSchema`      |
| `traces.evals`                         | query        | Permission `traces:view`   | inline                              | `tracesEvaluationRunsSchema`       |
| `traces.traceLogs`                     | query        | Permission `traces:view`   | inline                              | `tracesTraceLogsSchema`            |
| `traces.spansPaginated`                | query        | Permission `traces:view`   | inline                              | `tracesSpansPageSchema`            |
| `traces.spansDelta`                    | query        | Permission `traces:view`   | inline                              | `tracesSpansDeltaSchema`           |
| `traces.spanTreePaginated`             | query        | Permission `traces:view`   | `spanTreeTransportInputSchema`      | `spanTreePageSchema`               |
| `traces.spanTreeDelta`                 | query        | Permission `traces:view`   | `spanTreeDeltaTransportInputSchema` | `tracesSpanTreeNodesSchema`        |
| `traces.spanTree`                      | query        | Permission `traces:view`   | inline                              | `tracesSpanTreeNodesSchema`        |
| `traces.spanLangwatchSignals`          | query        | Permission `traces:view`   | inline                              | `tracesSpanLangwatchSignalsSchema` |
| `traces.spansFull`                     | query        | Permission `traces:view`   | inline                              | `tracesSpanDetailsSchema`          |
| `traces.spanDetail`                    | query        | Permission `traces:view`   | inline                              | `spanDetailSchema`                 |
| `traces.resourceInfo`                  | query        | Permission `traces:view`   | inline                              | `traceResourceInfoSchema`          |
| `traces.traceEvents`                   | query        | Permission `traces:view`   | inline                              | `tracesTraceEventsSchema`          |

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `trace_collector_evaluations` (aggregate `trace_collector_evaluation`)

Declared at `src/eventing/trace-collector-evaluations.pipeline.ts:17`. Events: `collectorEvaluationReceivedEventSchema`.

| Kind    | Name                        | Handles | Declared at                                               |
| ------- | --------------------------- | ------- | --------------------------------------------------------- |
| command | `recordCollectorEvaluation` | –       | `src/eventing/trace-collector-evaluations.pipeline.ts:22` |

### Pipeline `trace_ingest_source_billing` (aggregate `global`)

Declared at `src/eventing/trace-ingest-source-billing.pipeline.ts:31`.

| Kind            | Name                               | Handles                                                                                                        | Declared at                                               |
| --------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| peer subscriber | `traceIngestSourceBillingRecorded` | `lw.obs.coding_assistant_billing.recorded` from [governance](../../../enterprise/modules/governance/README.md) | `src/eventing/trace-ingest-source-billing.pipeline.ts:38` |

### Pipeline `trace_processing` (aggregate `trace`)

Declared at `src/eventing/trace-processing-projections.pipeline.ts:104`. Events: `spanReceivedEventSchema`, `spanRecordedEventSchema`, `topicAssignedEventSchema`, `logRecordReceivedEventSchema`, `logContributedEventSchema`, `metricDataPointCorrelatedEventSchema`, `originResolvedEventSchema`, `annotationAddedEventSchema`, `annotationRemovedEventSchema`, `annotationsBulkSyncedEventSchema`, `traceNameChangedEventSchema`.

| Kind                           | Name                                                                                           | Handles | Declared at                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------- |
| command                        | –                                                                                              | –       | `src/eventing/trace-processing-projections.pipeline.ts:152` |
| command                        | `assignTopic`                                                                                  | –       | `src/eventing/trace-processing-projections.pipeline.ts:158` |
| command                        | `recordLogContribution`                                                                        | –       | `src/eventing/trace-processing-projections.pipeline.ts:159` |
| command                        | `recordMetricCorrelation`                                                                      | –       | `src/eventing/trace-processing-projections.pipeline.ts:162` |
| command                        | `resolveOrigin`                                                                                | –       | `src/eventing/trace-processing-projections.pipeline.ts:165` |
| command                        | `addAnnotation`                                                                                | –       | `src/eventing/trace-processing-projections.pipeline.ts:166` |
| command                        | `removeAnnotation`                                                                             | –       | `src/eventing/trace-processing-projections.pipeline.ts:169` |
| command                        | `bulkSyncAnnotations`                                                                          | –       | `src/eventing/trace-processing-projections.pipeline.ts:172` |
| command                        | `changeTraceName`                                                                              | –       | `src/eventing/trace-processing-projections.pipeline.ts:175` |
| projection payload preparation | `≈ options.prepareEventForProjection`                                                          | –       | `src/eventing/trace-processing-projections.pipeline.ts:123` |
| ClickHouse fold projection     | `≈ TraceSummaryFoldProjection.create({ store: options.summaryStore, traceCanonicalisation: o…` | –       | `src/eventing/trace-processing-projections.pipeline.ts:124` |
| ClickHouse fold projection     | `≈ TraceAnalyticsFoldProjection.create({ store: options.derivedStore, traceCanonicalisation:…` | –       | `src/eventing/trace-processing-projections.pipeline.ts:131` |
| ClickHouse map projection      | `≈ SpanStorageMapProjection.create({ store: options.spanStore, spanCostService: runtime.span…` | –       | `src/eventing/trace-processing-projections.pipeline.ts:138` |
| ClickHouse map projection      | `≈ TraceAnalyticsRollupMapProjection.create({ store: options.rollupStore, spanCostService: r…` | –       | `src/eventing/trace-processing-projections.pipeline.ts:145` |

### Pipeline `trace_project_milestones` (aggregate `trace_project_milestone`)

Declared at `src/eventing/trace-project-milestones.pipeline.ts:21`. Events: `firstTraceRecordedEventSchema`, `traceReceivedEventSchema`.

| Kind    | Name                  | Handles | Declared at                                            |
| ------- | --------------------- | ------- | ------------------------------------------------------ |
| command | `recordFirstTrace`    | –       | `src/eventing/trace-project-milestones.pipeline.ts:26` |
| command | `recordTraceReceived` | –       | `src/eventing/trace-project-milestones.pipeline.ts:27` |

## Configuration

| Kind   | Leaf                       | Environment variable           | Declared at                          |
| ------ | -------------------------- | ------------------------------ | ------------------------------------ |
| config | `spanProcessingShards`     | `TRACE_SPAN_PROCESSING_SHARDS` | `../contract/src/trace.config.ts:9`  |
| config | `tokenizer.bpeDirectory`   | `TIKTOKENS_PATH`               | `../contract/src/trace.config.ts:11` |
| config | `tokenizer.fetchTimeoutMs` | `TIKTOKEN_FETCH_TIMEOUT_MS`    | `../contract/src/trace.config.ts:12` |
| config | `publicBaseUrl`            | `BASE_HOST`                    | `../contract/src/trace.config.ts:17` |

<!-- readme:generated:end -->

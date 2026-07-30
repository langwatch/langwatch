import type { ReplaceStore, StateRead, StoreContext, StoredState } from "@langwatch/event-sourcing";
import { createRowCodec, type ClickHouseClient, type WireCodec } from "@langwatch/clickhouse";
import { traceAnalyticsTable, type TraceAnalyticsRow } from "./table";
import { deriveTraceAnalyticsView } from "./traceAnalytics";
import { initTraceAnalyticsState, type TraceAnalyticsState } from "./traceAnalytics.schema";

const READ_YOUR_WRITES_SETTINGS = { select_sequential_consistency: 1 } as const;

const READ_SQL =
  `SELECT ${traceAnalyticsTable.columnNames.join(", ")} ` +
  `FROM ${traceAnalyticsTable.name} ` +
  `WHERE TenantId = {tenantId:String} AND TraceId = {key:String} ` +
  `ORDER BY UpdatedAt DESC LIMIT 1`;

function rowToState(row: TraceAnalyticsRow): TraceAnalyticsState {
  const base = initTraceAnalyticsState(row.TraceId);
  const attributes = JSON.parse(row.AttributesJson) as Record<string, string>;
  const ownedAttributes = new Map(Object.entries(attributes).map(([k, v]) => [k, { value: v, spanId: "" }]));
  const modelUsage = new Map(row.Models.map((model, index) => [model, -index]));
  const annotations = new Map(row.AnnotationIds.map((id) => [id, { present: true, actedAt: 0 }]));

  return {
    ...base,
    storageAnchorMs: row.AcceptedAt.getTime(),
    earliestSpanStartMs: Number(row.EarliestSpanStartMs),
    spanCount: Number(row.SpanCount),
    derivedSpanCount: row.DerivationCapped ? Number.MAX_SAFE_INTEGER : Number(row.SpanCount),
    totalDurationMs: Number(row.TotalDurationMs),
    rootCandidate:
      row.RootSpanStartTimeMs === null || row.TraceNameFromFallback
        ? null
        : { spanId: "", startTimeMs: Number(row.RootSpanStartTimeMs), name: row.TraceName, spanType: null },
    fallbackCandidate:
      row.RootSpanStartTimeMs === null || !row.TraceNameFromFallback
        ? null
        : { spanId: "", startTimeMs: Number(row.RootSpanStartTimeMs), name: row.TraceName, spanType: null },
    traceNameOverride: row.TraceNameFromFallback || row.TraceName === "" ? null : row.TraceName,
    topicId: row.TopicId,
    subTopicId: row.SubTopicId,
    topicAssignedAt: row.UpdatedAt.getTime(),
    hasError: row.HasError,
    modelUsage,
    totalCostRaw: row.TotalCost ?? 0,
    nonBilledCostRaw: row.NonBilledCost ?? 0,
    timeToFirstTokenMs: row.TimeToFirstTokenMs === null ? null : Number(row.TimeToFirstTokenMs),
    promptTokens: Number(row.PromptTokens),
    completionTokens: Number(row.CompletionTokens),
    cacheReadTokens: Number(row.CacheReadTokens),
    cacheWriteTokens: Number(row.CacheWriteTokens),
    reasoningTokens: Number(row.ReasoningTokens),
    annotations,
    attributes: ownedAttributes,
    labels: new Set(row.Labels),
  };
}

function stateToRow(args: {
  tenantId: string;
  key: string;
  state: TraceAnalyticsState;
  version: string;
  now: Date;
  retentionDays: number;
}): TraceAnalyticsRow {
  const view = deriveTraceAnalyticsView(args.state);
  return {
    TenantId: args.tenantId,
    TraceId: args.key,
    Version: args.version,
    AcceptedAt: new Date(view.occurredAtMs || args.now.getTime()),
    EarliestSpanStartMs: BigInt(Math.max(0, Math.round(view.earliestSpanStartMs))),
    SpanCount: BigInt(view.spanCount),
    DerivationCapped: view.derivationCapped,
    TraceName: view.traceName,
    TopicId: view.topicId,
    SubTopicId: view.subTopicId,
    UserId: view.userId,
    ConversationId: view.conversationId,
    CustomerId: view.customerId,
    Origin: view.origin,
    Models: view.models as string[],
    Labels: view.labels as string[],
    TotalCost: view.totalCost,
    NonBilledCost: view.nonBilledCost,
    TotalDurationMs: BigInt(Math.max(0, Math.round(view.totalDurationMs))),
    TimeToFirstTokenMs: view.timeToFirstTokenMs === null ? null : BigInt(Math.max(0, Math.round(view.timeToFirstTokenMs))),
    TokensPerSecond: view.tokensPerSecond === null ? null : BigInt(view.tokensPerSecond),
    PromptTokens: BigInt(view.promptTokens),
    CompletionTokens: BigInt(view.completionTokens),
    CacheReadTokens: BigInt(view.cacheReadTokens),
    CacheWriteTokens: BigInt(view.cacheWriteTokens),
    ReasoningTokens: BigInt(view.reasoningTokens),
    HasError: view.hasError,
    HasAnnotation: view.hasAnnotation,
    AnnotationIds: view.annotationIds as string[],
    AttributesJson: JSON.stringify(view.attributes),
    RootSpanStartTimeMs: view.rootSpanStartTimeMs === null ? null : BigInt(view.rootSpanStartTimeMs),
    TraceNameFromFallback: view.traceNameFromFallback,
    OccurredAt: new Date(view.earliestSpanStartMs || args.now.getTime()),
    UpdatedAt: args.now,
    _retention_days: args.retentionDays,
  };
}

const DEFAULT_RETENTION_DAYS = 308;

export interface TraceAnalyticsStoreArgs {
  readonly client: ClickHouseClient;
  readonly expectedVersion: string;
  /** @default createRowCodec() */
  readonly codec?: WireCodec;
}

export function createTraceAnalyticsStore(args: TraceAnalyticsStoreArgs): ReplaceStore<TraceAnalyticsState> {
  const { client, expectedVersion } = args;
  const codec = args.codec ?? createRowCodec();
  const wireColumns = traceAnalyticsTable.columnNames.map((name) => traceAnalyticsTable.columns[name]);
  const versionIndex = traceAnalyticsTable.columnNames.indexOf("Version");

  return {
    kind: "replace",

    async read(key: string, context: StoreContext): Promise<StateRead<TraceAnalyticsState>> {
      const result = await client.query({
        tenantId: context.tenantId,
        sql: READ_SQL,
        params: { tenantId: context.tenantId, key },
        settings: READ_YOUR_WRITES_SETTINGS,
      });

      const row = result.rows[0];
      if (!row) return { kind: "absent" };

      let storedVersion: string | undefined;
      try {
        storedVersion = traceAnalyticsTable.columns.Version.decode(row[versionIndex]);
      } catch (cause) {
        return { kind: "undecodable", storedVersion: undefined, cause };
      }
      if (storedVersion !== expectedVersion) return { kind: "undecodable", storedVersion };

      let decoded: TraceAnalyticsRow;
      try {
        const [decodedRow] = codec.decodeRows<TraceAnalyticsRow>({
          columns: wireColumns,
          columnNames: traceAnalyticsTable.columnNames,
          header: result.header,
          rows: [row],
        });
        if (!decodedRow) return { kind: "undecodable", storedVersion };
        decoded = decodedRow;
      } catch (cause) {
        return { kind: "undecodable", storedVersion, cause };
      }

      return {
        kind: "found",
        stored: { state: rowToState(decoded), version: storedVersion },
      };
    },

    async write(key: string, stored: StoredState<TraceAnalyticsState>, context: StoreContext): Promise<void> {
      const row = stateToRow({
        tenantId: context.tenantId,
        key,
        state: stored.state,
        version: stored.version,
        now: new Date(),
        retentionDays: context.retentionDays ?? DEFAULT_RETENTION_DAYS,
      });

      const encodedRows = codec.encodeRows({ columns: wireColumns, columnNames: traceAnalyticsTable.columnNames, rows: [row] });

      await client.insert({
        tenantId: context.tenantId,
        table: traceAnalyticsTable.name,
        rows: encodedRows,
        columns: traceAnalyticsTable.columnNames,
        target: { kind: "replacing" },
      });
    },
  };
}

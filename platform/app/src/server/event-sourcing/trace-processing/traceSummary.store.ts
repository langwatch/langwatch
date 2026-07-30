import type { ReplaceStore, StateRead, StoreContext, StoredState } from "@langwatch/event-sourcing";
import { createRowCodec, type ClickHouseClient, type WireCodec } from "@langwatch/clickhouse";
import { traceSummariesTable, type TraceSummariesRow } from "./table";
import { deriveTraceSummaryView } from "./traceSummary";
import { initTraceSummaryState, type TraceSummaryState } from "./traceSummary.schema";

/**
 * The row carries the derived view plus enough raw fields to continue folding
 * after a read-back. Read-back reseeds a fresh accumulator from the view, so
 * attribute/model provenance from before the reseed is lost — a later span
 * merges against a spanId-less owner rather than the original one.
 */

const READ_YOUR_WRITES_SETTINGS = { select_sequential_consistency: 1 } as const;

const READ_SQL =
  `SELECT ${traceSummariesTable.columnNames.join(", ")} ` +
  `FROM ${traceSummariesTable.name} ` +
  `WHERE TenantId = {tenantId:String} AND TraceId = {key:String} ` +
  `ORDER BY UpdatedAt DESC LIMIT 1`;

function rowToState(row: TraceSummariesRow): TraceSummaryState {
  const base = initTraceSummaryState(row.TraceId);
  const attributes = JSON.parse(row.AttributesJson) as Record<string, string>;
  const ownedAttributes = new Map(Object.entries(attributes).map(([k, v]) => [k, { value: v, spanId: "" }]));
  const modelUsage = new Map(row.Models.map((model, index) => [model, -index]));
  const annotations = new Map(row.AnnotationIds.map((id) => [id, { present: true, actedAt: 0 }]));

  return {
    ...base,
    spanCount: Number(row.SpanCount),
    derivedSpanCount: row.DerivationCapped ? Number.MAX_SAFE_INTEGER : Number(row.SpanCount),
    acceptedAtMs: row.AcceptedAt.getTime(),
    occurredAt: row.OccurredAt.getTime(),
    totalDurationMs: Number(row.TotalDurationMs),
    computedInput: row.ComputedInput === null ? null : { text: row.ComputedInput, tier: 0, endTimeMs: 0, spanId: "" },
    computedOutput: row.ComputedOutput === null ? null : { text: row.ComputedOutput, tier: 0, endTimeMs: 0, spanId: "" },
    timeToFirstTokenMs: row.TimeToFirstTokenMs === null ? null : Number(row.TimeToFirstTokenMs),
    timeToLastTokenMs: row.TimeToLastTokenMs === null ? null : Number(row.TimeToLastTokenMs),
    containsErrorStatus: row.ContainsErrorStatus,
    containsOKStatus: row.ContainsOKStatus,
    errorMessage: row.ErrorMessage === null ? null : { message: row.ErrorMessage, rank: 1, spanId: "" },
    modelUsage,
    totalCostRaw: row.TotalCost ?? 0,
    nonBilledCostRaw: row.NonBilledCost ?? 0,
    hasTokenUsage: row.HasTokenUsage,
    tokensEstimated: row.TokensEstimated,
    totalPromptTokenCount: row.TotalPromptTokenCount === null ? 0 : Number(row.TotalPromptTokenCount),
    totalCompletionTokenCount: row.TotalCompletionTokenCount === null ? 0 : Number(row.TotalCompletionTokenCount),
    blockedByGuardrail: row.BlockedByGuardrail,
    containsAi: row.ContainsAi,
    containsPrompt: row.ContainsPrompt,
    selectedPrompt:
      row.SelectedPromptId === null
        ? null
        : { promptId: row.SelectedPromptId, versionId: row.SelectedPromptVersionId, versionNumber: null, spanId: "", startTimeMs: 0 },
    lastUsedPrompt:
      row.LastUsedPromptId === null
        ? null
        : { promptId: row.LastUsedPromptId, versionId: row.LastUsedPromptVersionId, versionNumber: null, spanId: "", startTimeMs: Number.MAX_SAFE_INTEGER },
    rootCandidate:
      row.RootSpanStartTimeMs === null || row.TraceNameFromFallback
        ? null
        : { spanId: "", startTimeMs: Number(row.RootSpanStartTimeMs), name: row.TraceName, spanType: row.RootSpanType },
    fallbackCandidate:
      row.RootSpanStartTimeMs === null || !row.TraceNameFromFallback
        ? null
        : { spanId: "", startTimeMs: Number(row.RootSpanStartTimeMs), name: row.TraceName, spanType: row.RootSpanType },
    traceNameOverride: row.TraceNameFromFallback || row.TraceName === "" ? null : row.TraceName,
    topicId: row.TopicId,
    subTopicId: row.SubTopicId,
    topicAssignedAt: row.UpdatedAt.getTime(),
    annotations,
    attributes: ownedAttributes,
    labels: new Set(),
    promptIds: new Set(),
    piiPartialSpanIds: { ids: new Set(), overflowed: false },
    piiSkippedSpanIds: { ids: new Set(), overflowed: false },
  };
}

function stateToRow(args: {
  tenantId: string;
  key: string;
  state: TraceSummaryState;
  version: string;
  now: Date;
  retentionDays: number;
}): TraceSummariesRow {
  const view = deriveTraceSummaryView(args.state);
  return {
    TenantId: args.tenantId,
    TraceId: args.key,
    Version: args.version,
    SpanCount: BigInt(view.spanCount),
    DerivationCapped: view.derivationCapped,
    TotalDurationMs: BigInt(Math.max(0, Math.round(view.totalDurationMs))),
    ComputedInput: view.computedInput,
    ComputedOutput: view.computedOutput,
    TimeToFirstTokenMs: view.timeToFirstTokenMs === null ? null : BigInt(Math.max(0, Math.round(view.timeToFirstTokenMs))),
    TimeToLastTokenMs: view.timeToLastTokenMs === null ? null : BigInt(Math.max(0, Math.round(view.timeToLastTokenMs))),
    TokensPerSecond: view.tokensPerSecond === null ? null : BigInt(view.tokensPerSecond),
    ContainsErrorStatus: view.containsErrorStatus,
    ContainsOKStatus: view.containsOKStatus,
    ErrorMessage: view.errorMessage,
    Models: view.models as string[],
    TotalCost: view.totalCost,
    NonBilledCost: view.nonBilledCost,
    HasTokenUsage: view.hasTokenUsage,
    TokensEstimated: view.tokensEstimated,
    TotalPromptTokenCount: view.totalPromptTokenCount === null ? null : BigInt(view.totalPromptTokenCount),
    TotalCompletionTokenCount: view.totalCompletionTokenCount === null ? null : BigInt(view.totalCompletionTokenCount),
    BlockedByGuardrail: view.blockedByGuardrail,
    ContainsAi: view.containsAi,
    ContainsPrompt: view.containsPrompt,
    SelectedPromptId: view.selectedPrompt?.promptId ?? null,
    SelectedPromptVersionId: view.selectedPrompt?.versionId ?? null,
    LastUsedPromptId: view.lastUsedPrompt?.promptId ?? null,
    LastUsedPromptVersionId: view.lastUsedPrompt?.versionId ?? null,
    TraceName: view.traceName,
    RootSpanType: view.rootSpanType,
    RootSpanStartTimeMs: view.rootSpanStartTimeMs === null ? null : BigInt(view.rootSpanStartTimeMs),
    TraceNameFromFallback: view.traceNameFromFallback,
    TopicId: view.topicId,
    SubTopicId: view.subTopicId,
    AnnotationIds: view.annotationIds as string[],
    AttributesJson: JSON.stringify(view.attributes),
    OccurredAt: new Date(view.occurredAt || args.now.getTime()),
    AcceptedAt: new Date(args.state.acceptedAtMs || args.now.getTime()),
    UpdatedAt: args.now,
    _retention_days: args.retentionDays,
  };
}

const DEFAULT_RETENTION_DAYS = 308;

export interface TraceSummaryStoreArgs {
  readonly client: ClickHouseClient;
  readonly expectedVersion: string;
  /** @default createRowCodec() */
  readonly codec?: WireCodec;
}

export function createTraceSummaryStore(args: TraceSummaryStoreArgs): ReplaceStore<TraceSummaryState> {
  const { client, expectedVersion } = args;
  const codec = args.codec ?? createRowCodec();
  const wireColumns = traceSummariesTable.columnNames.map((name) => traceSummariesTable.columns[name]);
  const versionIndex = traceSummariesTable.columnNames.indexOf("Version");

  return {
    kind: "replace",

    async read(key: string, context: StoreContext): Promise<StateRead<TraceSummaryState>> {
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
        storedVersion = traceSummariesTable.columns.Version.decode(row[versionIndex]);
      } catch (cause) {
        return { kind: "undecodable", storedVersion: undefined, cause };
      }
      if (storedVersion !== expectedVersion) return { kind: "undecodable", storedVersion };

      let decoded: TraceSummariesRow;
      try {
        const [decodedRow] = codec.decodeRows<TraceSummariesRow>({
          columns: wireColumns,
          columnNames: traceSummariesTable.columnNames,
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

    async write(key: string, stored: StoredState<TraceSummaryState>, context: StoreContext): Promise<void> {
      const row = stateToRow({
        tenantId: context.tenantId,
        key,
        state: stored.state,
        version: stored.version,
        now: new Date(),
        retentionDays: context.retentionDays ?? DEFAULT_RETENTION_DAYS,
      });

      const encodedRows = codec.encodeRows({ columns: wireColumns, columnNames: traceSummariesTable.columnNames, rows: [row] });

      await client.insert({
        tenantId: context.tenantId,
        table: traceSummariesTable.name,
        rows: encodedRows,
        columns: traceSummariesTable.columnNames,
        target: { kind: "replacing" },
      });
    },
  };
}

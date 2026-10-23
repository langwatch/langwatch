/**
 * The braid dialog's and the Braids page's statements (ADR-185 §7). Each reads one project
 * under that project's own proof; a condition renders through `braidConditionExpression`, so
 * every key and literal is a bound parameter.
 */
import {
  braidConditionTermsOf,
  type Authorization,
  type CompiledWhere,
} from "@langwatch/authorization";
import {
  type AuthorizedClickHouse,
  braidConditionExpression,
  tenantScope,
  tenantScopeWithConditions,
} from "@langwatch/clickhouse-client";
import { z } from "zod";

import {
  NO_BRAID_TRACE_COUNTS,
  TraceBraidReadsRepository,
  type BraidActivityRead,
  type BraidOwnerTraceCounts,
  type BraidWindowRead,
  type TraceSpanTotalsGroup,
} from "../trace-braid-reads.repository.ts";
import type { TraceSpanSummaryRecord } from "../trace-projected-read.repository.ts";
import { ClickHouseTraceSpanRepository } from "./trace-span.repository.ts";

const count = z.coerce.number().int().min(0);
const traceIdRowsSchema = z.array(z.looseObject({ TraceId: z.string() }));
const ownerCountsRowsSchema = z.array(
  z.looseObject({
    every: count,
    some: count,
    shownSpans: count,
    liveEvery: count,
    liveSome: count,
    liveSpans: count,
    unsignedSpans: count,
    exampleTraceId: z.string(),
  }),
);
const attributeKeyRowsSchema = z.array(z.looseObject({ key: z.string(), spanCount: count }));
const braidedFlagRowsSchema = z.array(z.looseObject({ Braided: z.coerce.number() }));
const activityRowsSchema = z.array(z.record(z.string(), count));
const ownerActivityRowsSchema = z.array(z.object({ TenantId: z.string() }).catchall(z.unknown()));

/** The condition's `Verified()` terms apart from the rest, or none to count unsigned calls by. */
type VerifiedParts =
  | { kind: "unsigned" }
  | { kind: "signed"; rest: CompiledWhere | undefined; verified: CompiledWhere };

/** The span versions an attribute key read samples, newest partitions first. */
/** A span attribute read as a column; the key is fixed text, never a caller's value. */
const attribute = (key: string) => `SpanAttributes['${key}']`;
const attributeNumber = (key: string) => `toFloat64OrZero(${attribute(key)})`;
/** The attributes a span is priced by that group spans together: one rate per group. */
const PRICE_KEYS = [
  ["gen_ai.request.model", "Model"],
  ["gen_ai.response.model", "ResponseModel"],
  ["langwatch.model.inputCostPerToken", "CustomInputRate"],
  ["langwatch.model.outputCostPerToken", "CustomOutputRate"],
  ["langwatch.model.cacheReadCostPerToken", "CustomCacheReadRate"],
  ["langwatch.model.cacheCreationCostPerToken", "CustomCacheCreationRate"],
  ["langwatch.model.cacheCreation1hCostPerToken", "CustomCacheCreation1hRate"],
] as const;
/** The counts a price multiplies, summed per group: the cost is linear in each under one rate. */
const PRICE_COUNTS = [
  ["gen_ai.usage.cache_read.input_tokens", "CacheReadTokens"],
  ["gen_ai.usage.cache_creation.input_tokens", "CacheCreationTokens"],
  ["gen_ai.usage.cache_creation_1h.input_tokens", "CacheCreation1hTokens"],
  ["gen_ai.usage.input_chars", "InputChars"],
  ["gen_ai.usage.audio_seconds", "AudioSeconds"],
  ["gen_ai.usage.input_audio_tokens", "InputAudioTokens"],
  ["gen_ai.usage.output_audio_tokens", "OutputAudioTokens"],
  ["langwatch.span.cost", "SpanCost"],
] as const;
const total = z.coerce.number().catch(0);
const spanTotalsRowsSchema = z.array(
  z
    .looseObject({
      TenantId: z.string(),
      HasCost: z.coerce.number(),
      SpanCount: count,
      StartMs: z.coerce.number(),
      EndMs: z.coerce.number(),
      InputTokens: total,
      OutputTokens: total,
      Cost: total,
    })
    .catchall(z.unknown()),
);
const ATTRIBUTE_KEY_SAMPLE_ROWS = 50_000;
const MAX_TEST_TRACE_SPANS = 10_000;

const millis = (param: string) => `fromUnixTimestamp64Milli({${param}:Int64})`;

/** `1` for no condition, else the condition with its keys and literals bound under `prefix`. */
function conditionSql({
  compiledWhere,
  reader,
  prefix,
}: {
  compiledWhere: CompiledWhere | undefined;
  reader: string;
  prefix: string;
}): { sql: string; params: Record<string, unknown> } {
  if (compiledWhere === undefined) return { sql: "1", params: {} };
  return braidConditionExpression({ compiledWhere, reader, prefix });
}

/** A braid's own window on `StartTime`, its edges bound under `prefix`; an open end binds none. */
function windowSql({ braid, prefix }: { braid: BraidWindowRead; prefix: string }): {
  sql: string;
  params: Record<string, unknown>;
} {
  const from = `StartTime >= ${millis(`${prefix}_fromMs`)}`;
  if (braid.untilMs === null) return { sql: from, params: { [`${prefix}_fromMs`]: braid.fromMs } };
  return {
    sql: `${from} AND StartTime < ${millis(`${prefix}_untilMs`)}`,
    params: { [`${prefix}_fromMs`]: braid.fromMs, [`${prefix}_untilMs`]: braid.untilMs },
  };
}

/** Whether any braid shows a span: each its own window and condition, never merged; `0` if none. */
function anyBraidSql({ braids, prefix }: { braids: readonly BraidWindowRead[]; prefix: string }): {
  sql: string;
  params: Record<string, unknown>;
} {
  if (braids.length === 0) return { sql: "0", params: {} };
  const params: Record<string, unknown> = {};
  const picks = braids.map((braid, index) => {
    const named = `${prefix}${index}`;
    const window = windowSql({ braid, prefix: named });
    const condition = conditionSql({
      compiledWhere: braid.compiledWhere,
      reader: braid.readerProjectId,
      prefix: named,
    });
    Object.assign(params, window.params, condition.params);
    return `(${window.sql} AND ${condition.sql})`;
  });
  return { sql: `(${picks.join(" OR ")})`, params };
}

function verifiedPartsOf(compiledWhere: CompiledWhere | undefined): VerifiedParts {
  if (compiledWhere === undefined) return { kind: "unsigned" };
  const terms = braidConditionTermsOf(compiledWhere.tree);
  const verified = terms.filter((term) => term.kind === "verified");
  if (verified.length === 0) return { kind: "unsigned" };
  const rest = terms.filter((term) => term.kind !== "verified");
  const of = (part: typeof terms): CompiledWhere => ({
    version: compiledWhere.version,
    tree: { kind: "and", terms: part },
  });
  return { kind: "signed", rest: rest.length === 0 ? undefined : of(rest), verified: of(verified) };
}

export class ClickHouseTraceBraidReadsRepository extends TraceBraidReadsRepository {
  private constructor(private readonly clickhouse: AuthorizedClickHouse) {
    super();
  }

  static create(options: {
    clickhouse: AuthorizedClickHouse;
  }): ClickHouseTraceBraidReadsRepository {
    return new ClickHouseTraceBraidReadsRepository(options.clickhouse);
  }

  async findReaderTraceIds(input: {
    authorization: Authorization;
    sinceMs: number;
    limit: number;
  }): Promise<string[]> {
    const client = this.clickhouse.as(input.authorization, { reads: "traces" });
    const result = await client.query({
      // ID_BOUND_SKIP: a window read over the reader's own traces, bounded by OccurredAt.
      query: `
        SELECT TraceId
        FROM trace_summaries
        WHERE ${tenantScope("OccurredAt")}
          AND OccurredAt >= ${millis("sinceMs")}
        GROUP BY TraceId
        ORDER BY max(OccurredAt) DESC, TraceId ASC
        LIMIT {limit:UInt32}
      `,
      query_params: { sinceMs: input.sinceMs, limit: input.limit },
      format: "JSONEachRow",
    });
    return traceIdRowsSchema.parse(await result.json()).map((row) => row.TraceId);
  }

  /**
   * One statement under the owner's proof: per span, whether the live braids show it and whether
   * they or the draft do, each braid in its own window; per trace, the counts; and the newest trace
   * shown any span, so the example is one of `traceIds` by construction.
   */
  async countOwnerSpansInTraces(input: {
    authorization: Authorization;
    traceIds: readonly string[];
    sinceMs: number;
    live: readonly BraidWindowRead[];
    draft: BraidWindowRead;
  }): Promise<BraidOwnerTraceCounts> {
    const { draft } = input;
    const reader = draft.readerProjectId;
    const live = anyBraidSql({ braids: input.live, prefix: "live" });
    const draftWindow = windowSql({ braid: draft, prefix: "braid" });
    const matched = conditionSql({ compiledWhere: draft.compiledWhere, reader, prefix: "braid" });
    const split = verifiedPartsOf(draft.compiledWhere);
    const signed = split.kind === "signed" ? split : null;
    const rest = conditionSql({ compiledWhere: signed?.rest, reader, prefix: "braidRest" });
    const verified = signed
      ? conditionSql({ compiledWhere: signed.verified, reader, prefix: "braidSigned" })
      : null;
    const shown = `(${live.sql} OR (${draftWindow.sql} AND ${matched.sql}))`;
    const unsigned = verified
      ? `(${draftWindow.sql} AND ${rest.sql} AND NOT ${verified.sql} AND NOT ${live.sql})`
      : "0";
    const client = this.clickhouse.as(input.authorization, { reads: "traces" });
    const result = await client.query({
      // ID_BOUND_SKIP: bounded by the reader's trace ids and the 7-day StartTime floor.
      query: `
        SELECT
          countIf(spans > 0 AND shown = spans) AS every,
          countIf(shown > 0 AND shown < spans) AS some,
          sum(shown) AS shownSpans,
          countIf(spans > 0 AND liveShown = spans) AS liveEvery,
          countIf(liveShown > 0 AND liveShown < spans) AS liveSome,
          sum(liveShown) AS liveSpans,
          sum(unsigned) AS unsignedSpans,
          argMaxIf(TraceId, newest, shown > 0) AS exampleTraceId
        FROM (
          SELECT TraceId, count() AS spans, max(started) AS newest,
            sum(s) AS shown, sum(l) AS liveShown, sum(u) AS unsigned
          FROM (
            SELECT TraceId, SpanId, max(StartTime) AS started,
              argMax(${shown}, UpdatedAt) AS s,
              argMax(${live.sql}, UpdatedAt) AS l,
              argMax(${unsigned}, UpdatedAt) AS u
            FROM stored_spans
            WHERE ${tenantScope("StartTime")}
              AND TraceId IN {traceIds:Array(String)}
              AND StartTime >= ${millis("sinceMs")}
            GROUP BY TraceId, SpanId
          )
          GROUP BY TraceId
        )
      `,
      query_params: {
        traceIds: [...input.traceIds],
        sinceMs: input.sinceMs,
        ...live.params,
        ...draftWindow.params,
        ...matched.params,
        ...rest.params,
        ...verified?.params,
      },
      format: "JSONEachRow",
    });
    const [row] = ownerCountsRowsSchema.parse(await result.json());
    if (row === undefined) return NO_BRAID_TRACE_COUNTS;
    return {
      shown: { every: row.every, some: row.some, spans: row.shownSpans },
      live: { every: row.liveEvery, some: row.liveSome, spans: row.liveSpans },
      unsigned: row.unsignedSpans,
      exampleTraceId: row.exampleTraceId === "" ? null : row.exampleTraceId,
    };
  }

  async findAttributeKeys(input: {
    authorization: Authorization;
    sinceMs: number;
    limit: number;
    excludedPrefix: string;
  }): Promise<{ key: string; spanCount: number }[]> {
    const client = this.clickhouse.as(input.authorization, { reads: "traces" });
    const result = await client.query({
      // ID_BOUND_SKIP: a sampled window read over the owner's own spans, bounded by StartTime.
      query: `
        SELECT key, count() AS spanCount
        FROM (
          SELECT SpanAttributes
          FROM stored_spans
          WHERE ${tenantScope("StartTime")}
            AND StartTime >= ${millis("sinceMs")}
          LIMIT {sampleRows:UInt32}
        )
        ARRAY JOIN mapKeys(SpanAttributes) AS key
        WHERE NOT startsWith(key, {excludedPrefix:String})
        GROUP BY key
        ORDER BY spanCount DESC, key ASC
        LIMIT {limit:UInt32}
      `,
      query_params: {
        sinceMs: input.sinceMs,
        sampleRows: ATTRIBUTE_KEY_SAMPLE_ROWS,
        excludedPrefix: input.excludedPrefix,
        limit: input.limit,
      },
      format: "JSONEachRow",
    });
    return attributeKeyRowsSchema
      .parse(await result.json())
      .map((row) => ({ key: row.key, spanCount: row.spanCount }));
  }

  async countOwnerBraidActivity(input: {
    authorization: Authorization;
    braids: readonly BraidActivityRead[];
    sinceMs: number;
  }): Promise<Map<string, number>> {
    if (input.braids.length === 0) return new Map();
    const columns = braidColumns(input.braids);
    const client = this.clickhouse.as(input.authorization, { reads: "traces" });
    const result = await client.query({
      // ID_BOUND_SKIP: a 24-hour window read over the owner's own spans, bounded by StartTime.
      query: `
        SELECT ${columns.names.map((name) => `sum(${name}) AS ${name}`).join(", ")}
        FROM (
          SELECT ${columns.windowed.map(({ name, sql }) => `argMax(${sql}, UpdatedAt) AS ${name}`).join(",\n            ")}
          FROM stored_spans
          WHERE ${tenantScope("StartTime")}
            AND StartTime >= ${millis("sinceMs")}
          GROUP BY TraceId, SpanId
        )
      `,
      query_params: { sinceMs: input.sinceMs, ...columns.params },
      format: "JSONEachRow",
    });
    const [row = {}] = activityRowsSchema.parse(await result.json());
    return new Map(input.braids.map((braid, index) => [braid.braidId, row[`a${index}`] ?? 0]));
  }

  async countReaderBraidActivity(input: {
    authorization: Authorization;
    braids: readonly BraidActivityRead[];
    sinceMs: number;
  }): Promise<Map<string, number>> {
    if (input.braids.length === 0) return new Map();
    const columns = braidColumns(input.braids);
    const client = this.clickhouse.as(input.authorization, { reads: "spans" });
    const result = await client.query({
      // ID_BOUND_SKIP: a 24-hour window read through the reader's fence, bounded by StartTime.
      query: `
        SELECT TenantId, ${columns.windowed.map(({ name, sql }) => `countIf(${sql}) AS ${name}`).join(", ")}
        FROM stored_spans
        WHERE ${tenantScopeWithConditions("StartTime")}
          AND StartTime >= ${millis("sinceMs")}
          AND (TenantId, TraceId, SpanId, UpdatedAt) IN (
            SELECT TenantId, TraceId, SpanId, max(UpdatedAt)
            FROM stored_spans
            WHERE ${tenantScope("StartTime")}
              AND StartTime >= ${millis("sinceMs")}
            GROUP BY TenantId, TraceId, SpanId
          )
        GROUP BY TenantId
      `,
      query_params: { sinceMs: input.sinceMs, ...columns.params },
      format: "JSONEachRow",
    });
    const rows = ownerActivityRowsSchema.parse(await result.json());
    const byOwner = new Map(rows.map((row) => [row.TenantId, row]));
    return new Map(
      input.braids.map((braid, index) => [
        braid.braidId,
        count.catch(0).parse(byOwner.get(braid.ownerProjectId)?.[`a${index}`] ?? 0),
      ]),
    );
  }

  async sumSpansInTrace(input: {
    authorization: Authorization;
    traceId: string;
    occurredAtMs?: number | undefined;
  }): Promise<TraceSpanTotalsGroup[]> {
    const client = this.clickhouse.as(input.authorization, { reads: "spans" });
    const keys = PRICE_KEYS.map(([key, name]) => `${attribute(key)} AS ${name}`);
    const counts = PRICE_COUNTS.map(([key, name]) => `sum(${attributeNumber(key)}) AS ${name}`);
    const result = await client.query({
      query: `
        SELECT TenantId,
          ${attributeNumber("gen_ai.usage.cost")} > 0 AS HasCost,
          ${attributeNumber("langwatch.span.cost")} > 0 AS HasSpanCost,
          ${keys.join(",\n          ")},
          count() AS SpanCount,
          min(toUnixTimestamp64Milli(StartTime)) AS StartMs,
          max(toUnixTimestamp64Milli(EndTime)) AS EndMs,
          sum(${attributeNumber("gen_ai.usage.input_tokens")}) AS InputTokens,
          sum(${attributeNumber("gen_ai.usage.output_tokens")}) AS OutputTokens,
          sum(${attributeNumber("gen_ai.usage.cost")}) AS Cost,
          ${counts.join(",\n          ")}
        FROM stored_spans
        WHERE ${tenantScopeWithConditions("StartTime")} AND TraceId = {traceId:String}
          {{idBound:stored_spans.TraceId:traceId}}
          AND (TenantId, TraceId, SpanId, UpdatedAt) IN (
            SELECT TenantId, TraceId, SpanId, max(UpdatedAt)
            FROM stored_spans
            WHERE ${tenantScope("StartTime")} AND TraceId = {traceId:String}
              {{idBound:stored_spans.TraceId:traceId}}
            GROUP BY TenantId, TraceId, SpanId
          )
        GROUP BY TenantId, HasCost, HasSpanCost, ${PRICE_KEYS.map(([, name]) => name).join(", ")}
      `,
      query_params: { traceId: input.traceId },
      format: "JSONEachRow",
      idBound: {
        occurredAtHint: input.occurredAtMs ?? null,
        fallback: "unbounded",
        openEnded: true,
      },
    });
    return spanTotalsRowsSchema.parse(await result.json()).map((row) => ({
      tenantId: row.TenantId,
      spanCount: row.SpanCount,
      startMs: row.StartMs,
      endMs: row.EndMs,
      inputTokens: row.InputTokens,
      outputTokens: row.OutputTokens,
      explicitCost: row.HasCost === 1 ? row.Cost : 0,
      costInput: row.HasCost === 1 ? null : costInputOf(row),
    }));
  }

  async findOwnerSpansMarked(input: {
    authorization: Authorization;
    traceId: string;
    braids: readonly BraidWindowRead[];
  }): Promise<(TraceSpanSummaryRecord & { braided: boolean })[]> {
    const braided = anyBraidSql({ braids: input.braids, prefix: "braid" });
    const client = this.clickhouse.as(input.authorization, { reads: "traces" });
    const result = await client.query({
      query: `
        SELECT ${ClickHouseTraceSpanRepository.summarySelect},
          ${braided.sql} AS Braided
        FROM stored_spans
        WHERE ${tenantScope("StartTime")} AND TraceId = {traceId:String}
          {{idBound:stored_spans.TraceId:traceId}}
          AND (TenantId, TraceId, SpanId, UpdatedAt) IN (
            SELECT TenantId, TraceId, SpanId, max(UpdatedAt)
            FROM stored_spans
            WHERE ${tenantScope("StartTime")} AND TraceId = {traceId:String}
              {{idBound:stored_spans.TraceId:traceId}}
            GROUP BY TenantId, TraceId, SpanId
          )
        ORDER BY StartTimeMs ASC
        LIMIT ${MAX_TEST_TRACE_SPANS}
      `,
      query_params: { traceId: input.traceId, ...braided.params },
      format: "JSONEachRow",
      idBound: { occurredAtHint: null, fallback: "unbounded", openEnded: true },
    });
    const rows: unknown = await result.json();
    const flags = braidedFlagRowsSchema.parse(rows);
    return ClickHouseTraceSpanRepository.summaryRecordsOf({
      rows,
      authorization: input.authorization,
    }).map((record, index) => ({ ...record, braided: flags[index]?.Braided === 1 }));
  }
}

/** A group's pricing inputs, in the shape the tree prices one span by. */
function costInputOf(row: Record<string, unknown>): TraceSpanTotalsGroup["costInput"] {
  const text = (name: string) =>
    typeof row[name] === "string" && row[name] !== "" ? row[name] : undefined;
  const attrs: Record<string, unknown> = {};
  for (const [key, name] of PRICE_KEYS) attrs[key] = text(name);
  for (const [key, name] of PRICE_COUNTS) attrs[key] = total.parse(row[name]) || undefined;
  return {
    attrs,
    model: text("ResponseModel") ?? text("Model"),
    promptTokens: total.parse(row.InputTokens),
    completionTokens: total.parse(row.OutputTokens),
  };
}

/** One `a<i>` column per braid: its window and condition, every literal bound under `a<i>`. */
function braidColumns(braids: readonly BraidActivityRead[]): {
  names: string[];
  windowed: { name: string; sql: string }[];
  params: Record<string, unknown>;
} {
  const params: Record<string, unknown> = {};
  const windowed = braids.map((braid, index) => {
    const name = `a${index}`;
    const condition = conditionSql({
      compiledWhere: braid.compiledWhere,
      reader: braid.readerProjectId,
      prefix: name,
    });
    Object.assign(params, condition.params, {
      [`${name}_fromMs`]: braid.fromMs,
      [`${name}_untilMs`]: braid.untilMs,
    });
    const window = `StartTime >= ${millis(`${name}_fromMs`)} AND StartTime < ${millis(`${name}_untilMs`)}`;
    return { name, sql: `(${window} AND ${condition.sql})` };
  });
  return { names: windowed.map(({ name }) => name), windowed, params };
}

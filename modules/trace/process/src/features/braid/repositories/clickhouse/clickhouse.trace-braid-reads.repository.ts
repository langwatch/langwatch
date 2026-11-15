/**
 * The braid dialog's and the Braids page's statements (ADR-201 §7). Each reads one project
 * under that project's own proof; a condition renders through the builder's `braidCondition`, so
 * every key and literal is a bound parameter.
 */
import {
  braidConditionTermsOf,
  type Authorization,
  type CompiledWhere,
} from "@langwatch/authorization";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import {
  braidCondition,
  clickhouseRead,
  cond,
  fn,
  tenantScope as builtTenantScope,
} from "@langwatch/clickhouse-client/builder";
import { z } from "zod";

import { storedSpans } from "../../../../repositories/clickhouse/clickhouse.stored-spans.table.ts";
import { traceSummaries } from "../../../../repositories/clickhouse/clickhouse.trace-summaries.table.ts";
import { ClickHouseTraceSpanRepository } from "../../../../repositories/clickhouse/trace-span.repository.ts";
import type { TraceSpanSummaryRecord } from "../../../../repositories/trace-projected-read.repository.ts";
import {
  NO_BRAID_TRACE_COUNTS,
  TraceBraidReadsRepository,
  type BraidActivityRead,
  type BraidOwnerTraceCounts,
  type BraidWindowRead,
  type TraceSpanTotalsGroup,
} from "../trace-braid-reads.repository.ts";

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
      UsageCost: total,
    })
    .catchall(z.unknown()),
);
const ATTRIBUTE_KEY_SAMPLE_ROWS = 50_000;
const MAX_TEST_TRACE_SPANS = 10_000;

/** A braid's own window on `StartTime`; an open end bounds nothing. */
function braidWindow(braid: BraidWindowRead) {
  const from = cond.gte(storedSpans.StartTime, braid.fromMs);
  if (braid.untilMs === null) return from;
  return cond.and(from, cond.lt(storedSpans.StartTime, braid.untilMs));
}

/** A condition with every key and literal bound; none holds every span. */
function conditionOf(compiledWhere: CompiledWhere | undefined, reader: string) {
  if (compiledWhere === undefined) return undefined;
  return braidCondition(storedSpans, { compiledWhere, reader });
}

/** A braid's window and its condition. */
function braidPick(braid: BraidWindowRead) {
  const condition = conditionOf(braid.compiledWhere, braid.readerProjectId);
  return condition === undefined ? braidWindow(braid) : cond.and(braidWindow(braid), condition);
}

/** A span in the draft window only its `Verified()` terms hold back, which no live braid shows. */
function unsignedOf({
  draft,
  split,
  liveShown,
}: {
  draft: BraidWindowRead;
  split: Extract<VerifiedParts, { kind: "signed" }>;
  liveShown: ReturnType<typeof anyBraid>;
}) {
  const window = braidWindow(draft);
  const held = cond.not(
    braidCondition(storedSpans, { compiledWhere: split.verified, reader: draft.readerProjectId }),
  );
  const rest = conditionOf(split.rest, draft.readerProjectId);
  const unshown = cond.not(liveShown);
  return rest === undefined
    ? cond.and(window, held, unshown)
    : cond.and(window, rest, held, unshown);
}

/** Whether any braid shows a span: each its own window and condition, never merged. */
function anyBraid(braids: readonly BraidWindowRead[]) {
  if (braids.length === 0) return cond.never();
  return braids.map(braidPick).reduce((shown, pick) => cond.or(shown, pick));
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

/** The reader's own traces since `sinceMs` under its proof's windows, newest first. */
function readerTraceIdsStatement({
  authorization,
  sinceMs,
  limit,
}: {
  authorization: Authorization;
  sinceMs: number;
  limit: number;
}) {
  return clickhouseRead({ scope: builtTenantScope.fromProof({ authorization, reads: "traces" }) })
    .from(traceSummaries)
    .withinWindows()
    .select({ TraceId: traceSummaries.TraceId })
    .where(({ gte }) => gte(traceSummaries.OccurredAt, sinceMs))
    .groupBy(traceSummaries.TraceId)
    .orderBy(fn.max(traceSummaries.OccurredAt), "DESC")
    .orderBy(traceSummaries.TraceId, "ASC")
    .limit(limit)
    .build();
}

/** A span attribute read as a column, its key bound. */
const attribute = (key: string) => fn.mapGet(storedSpans.SpanAttributes, key);
const attributeNumber = (key: string) => fn.toFloat64OrZero(attribute(key));
const priceKeyColumns = Object.fromEntries(
  PRICE_KEYS.map(([key, name]) => [name, attribute(key)] as const),
);
const priceCountColumns = Object.fromEntries(
  PRICE_COUNTS.map(([key, name]) => [name, fn.sum(attributeNumber(key))] as const),
);

/** One trace's latest spans under the braided proof, summed per owner and price group. */
function spanTotalsStatement({
  authorization,
  traceId,
}: {
  authorization: Authorization;
  traceId: string;
}) {
  const hasCost = cond.gt(attributeNumber("gen_ai.usage.cost"), 0);
  const hasSpanCost = cond.gt(attributeNumber("langwatch.span.cost"), 0);
  return clickhouseRead({ scope: builtTenantScope.fromProof({ authorization, reads: "spans" }) })
    .from(storedSpans)
    .braided({ heldTrace: { traceId } })
    .select({
      TenantId: storedSpans.TenantId,
      HasCost: hasCost,
      HasSpanCost: hasSpanCost,
      ...priceKeyColumns,
      SpanCount: fn.count(),
      StartMs: fn.min(fn.toUnixTimestamp64Milli(storedSpans.StartTime)),
      EndMs: fn.max(fn.toUnixTimestamp64Milli(storedSpans.EndTime)),
      InputTokens: fn.sum(attributeNumber("gen_ai.usage.input_tokens")),
      OutputTokens: fn.sum(attributeNumber("gen_ai.usage.output_tokens")),
      UsageCost: fn.sum(attributeNumber("gen_ai.usage.cost")),
      ...priceCountColumns,
    })
    .where(({ idBound }) => idBound(storedSpans.TraceId, traceId))
    .latestVersion()
    .groupBy(storedSpans.TenantId, hasCost, hasSpanCost, ...Object.values(priceKeyColumns))
    .build();
}

/**
 * Per span, whether the live braids show it and whether they or the draft do, each braid in its
 * own window; per trace, the counts; and the newest trace shown any span.
 */
function ownerSpansInTracesStatement({
  authorization,
  traceIds,
  sinceMs,
  live,
  draft,
}: {
  authorization: Authorization;
  traceIds: readonly string[];
  sinceMs: number;
  live: readonly BraidWindowRead[];
  draft: BraidWindowRead;
}) {
  const scope = builtTenantScope.fromProof({ authorization, reads: "traces" });
  const liveShown = anyBraid(live);
  const shown = cond.or(liveShown, braidPick(draft));
  const split = verifiedPartsOf(draft.compiledWhere);
  const unsigned = split.kind === "signed" ? unsignedOf({ draft, split, liveShown }) : cond.never();
  const perSpan = clickhouseRead({ scope })
    .from(storedSpans)
    .withinWindows()
    .select({
      TraceId: storedSpans.TraceId,
      started: fn.max(storedSpans.StartTime),
      s: fn.argMax(shown, storedSpans.UpdatedAt),
      l: fn.argMax(liveShown, storedSpans.UpdatedAt),
      u: fn.argMax(unsigned, storedSpans.UpdatedAt),
    })
    .where(({ oneOf }) => oneOf(storedSpans.TraceId, [...traceIds]))
    .where(({ gte }) => gte(storedSpans.StartTime, sinceMs))
    .groupBy(storedSpans.TraceId, storedSpans.SpanId)
    .as("perSpan");
  const perTrace = clickhouseRead({ scope })
    .from(perSpan)
    .select({
      TraceId: perSpan.TraceId,
      spans: fn.count(),
      newest: fn.max(perSpan.started),
      shown: fn.countIf(perSpan.s),
      liveShown: fn.countIf(perSpan.l),
      unsigned: fn.countIf(perSpan.u),
    })
    .groupBy(perSpan.TraceId)
    .as("perTrace");
  const every = (of: typeof perTrace.shown | typeof perTrace.liveShown) =>
    fn.countIf(cond.and(cond.gt(perTrace.spans, 0), cond.eq(of, perTrace.spans)));
  const some = (of: typeof perTrace.shown | typeof perTrace.liveShown) =>
    fn.countIf(cond.and(cond.gt(of, 0), cond.lt(of, perTrace.spans)));
  return clickhouseRead({ scope })
    .from(perTrace)
    .select({
      every: every(perTrace.shown),
      some: some(perTrace.shown),
      shownSpans: fn.sum(perTrace.shown),
      liveEvery: every(perTrace.liveShown),
      liveSome: some(perTrace.liveShown),
      liveSpans: fn.sum(perTrace.liveShown),
      unsignedSpans: fn.sum(perTrace.unsigned),
      exampleTraceId: fn.argMaxIf(perTrace.TraceId, perTrace.newest, cond.gt(perTrace.shown, 0)),
    })
    .build();
}

/** The owner's attribute keys over a sample of its spans in its own windows, most used first. */
function attributeKeysStatement({
  authorization,
  sinceMs,
  limit,
  excludedPrefix,
}: {
  authorization: Authorization;
  sinceMs: number;
  limit: number;
  excludedPrefix: string;
}) {
  const scope = builtTenantScope.fromProof({ authorization, reads: "traces" });
  const sampled = clickhouseRead({ scope })
    .from(storedSpans)
    .withinWindows()
    .select({ SpanAttributes: storedSpans.SpanAttributes })
    .where(({ gte }) => gte(storedSpans.StartTime, sinceMs))
    .limit(ATTRIBUTE_KEY_SAMPLE_ROWS)
    .as("sampled");
  const keys = clickhouseRead({ scope })
    .from(sampled)
    .select({ key: fn.arrayJoin(fn.mapKeys(sampled.SpanAttributes)) })
    .as("keys");
  return clickhouseRead({ scope })
    .from(keys)
    .select({ key: keys.key, spanCount: fn.count() })
    .where(({ not }) => not(fn.startsWith(keys.key, excludedPrefix)))
    .groupBy(keys.key)
    .orderBy("spanCount", "DESC")
    .orderBy("key", "ASC")
    .limit(limit)
    .build();
}

/** Per braid, the owner's spans whose latest version it shows, in its own window. */
function ownerBraidActivityStatement({
  authorization,
  braids,
  sinceMs,
}: {
  authorization: Authorization;
  braids: readonly BraidActivityRead[];
  sinceMs: number;
}) {
  const scope = builtTenantScope.fromProof({ authorization, reads: "traces" });
  const perSpan = clickhouseRead({ scope })
    .from(storedSpans)
    .withinWindows()
    .select(
      Object.fromEntries(
        braids.map((braid, index) => [
          `a${index}`,
          fn.argMax(braidPick(braid), storedSpans.UpdatedAt),
        ]),
      ),
    )
    .where(({ gte }) => gte(storedSpans.StartTime, sinceMs))
    .groupBy(storedSpans.TraceId, storedSpans.SpanId)
    .as("perSpan");
  return clickhouseRead({ scope })
    .from(perSpan)
    .select(
      Object.fromEntries(
        braids.flatMap((_, index) => {
          const shown = perSpan[`a${index}`];
          return shown === undefined ? [] : [[`a${index}`, fn.countIf(shown)] as const];
        }),
      ),
    )
    .build();
}

/** Per owner and braid, the latest spans the reader's braided fence shows in the braid's window. */
function readerBraidActivityStatement({
  authorization,
  braids,
  sinceMs,
}: {
  authorization: Authorization;
  braids: readonly BraidActivityRead[];
  sinceMs: number;
}) {
  return clickhouseRead({ scope: builtTenantScope.fromProof({ authorization, reads: "spans" }) })
    .from(storedSpans)
    .braided({ heldTrace: { sinceMs } })
    .select({
      TenantId: storedSpans.TenantId,
      ...Object.fromEntries(
        braids.map((braid, index) => [`a${index}`, fn.countIf(braidPick(braid))]),
      ),
    })
    .where(({ gte }) => gte(storedSpans.StartTime, sinceMs))
    .latestVersion()
    .groupBy(storedSpans.TenantId)
    .build();
}

/** One trace's latest owner spans in the owner's windows, each flagged when any braid shows it. */
function ownerSpansMarkedStatement({
  authorization,
  traceId,
  braids,
}: {
  authorization: Authorization;
  traceId: string;
  braids: readonly BraidWindowRead[];
}) {
  return clickhouseRead({ scope: builtTenantScope.fromProof({ authorization, reads: "traces" }) })
    .from(storedSpans)
    .withinWindows()
    .select({
      ...ClickHouseTraceSpanRepository.summarySelection(authorization),
      Braided: anyBraid(braids),
    })
    .where(({ idBound }) => idBound(storedSpans.TraceId, traceId))
    .latestVersion()
    .orderBy(fn.toUnixTimestamp64Milli(storedSpans.StartTime), "ASC")
    .limit(MAX_TEST_TRACE_SPANS)
    .build();
}

export class ClickHouseTraceBraidReadsRepository extends TraceBraidReadsRepository {
  private constructor(private readonly reader: Pick<ClickHouseQueryClient, "read">) {
    super();
  }

  static create(options: {
    reader: Pick<ClickHouseQueryClient, "read">;
  }): ClickHouseTraceBraidReadsRepository {
    return new ClickHouseTraceBraidReadsRepository(options.reader);
  }

  async findReaderTraceIds(input: {
    authorization: Authorization;
    sinceMs: number;
    limit: number;
  }): Promise<string[]> {
    const result = await this.reader.read({
      // ID_BOUND_SKIP: a window read over the reader's own traces, bounded by OccurredAt.
      statement: readerTraceIdsStatement(input),
      table: traceSummaries.$table.name,
    });
    return traceIdRowsSchema.parse(result.rows).map((row) => row.TraceId);
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
    const result = await this.reader.read({
      // ID_BOUND_SKIP: bounded by the reader's trace ids and the 7-day StartTime floor.
      statement: ownerSpansInTracesStatement(input),
      table: storedSpans.$table.name,
    });
    const [row] = ownerCountsRowsSchema.parse(result.rows);
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
    const result = await this.reader.read({
      // ID_BOUND_SKIP: a sampled window read over the owner's own spans, bounded by StartTime.
      statement: attributeKeysStatement(input),
      table: storedSpans.$table.name,
    });
    return attributeKeyRowsSchema
      .parse(result.rows)
      .map((row) => ({ key: row.key, spanCount: row.spanCount }));
  }

  async countOwnerBraidActivity(input: {
    authorization: Authorization;
    braids: readonly BraidActivityRead[];
    sinceMs: number;
  }): Promise<Map<string, number>> {
    if (input.braids.length === 0) return new Map();
    const result = await this.reader.read({
      // ID_BOUND_SKIP: a 24-hour window read over the owner's own spans, bounded by StartTime.
      statement: ownerBraidActivityStatement(input),
      table: storedSpans.$table.name,
    });
    const [row = {}] = activityRowsSchema.parse(result.rows);
    return new Map(input.braids.map((braid, index) => [braid.braidId, row[`a${index}`] ?? 0]));
  }

  async countReaderBraidActivity(input: {
    authorization: Authorization;
    braids: readonly BraidActivityRead[];
    sinceMs: number;
  }): Promise<Map<string, number>> {
    if (input.braids.length === 0) return new Map();
    const result = await this.reader.read({
      // ID_BOUND_SKIP: a 24-hour window read through the reader's fence, bounded by StartTime.
      statement: readerBraidActivityStatement(input),
      table: storedSpans.$table.name,
    });
    const rows = ownerActivityRowsSchema.parse(result.rows);
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
    const result = await this.reader.read({
      statement: spanTotalsStatement(input),
      table: storedSpans.$table.name,
      idBound: {
        occurredAtHint: input.occurredAtMs ?? null,
        fallback: "unbounded",
        openEnded: true,
      },
    });
    return spanTotalsRowsSchema.parse(result.rows).map((row) => ({
      tenantId: row.TenantId,
      spanCount: row.SpanCount,
      startMs: row.StartMs,
      endMs: row.EndMs,
      inputTokens: row.InputTokens,
      outputTokens: row.OutputTokens,
      explicitCost: row.HasCost === 1 ? row.UsageCost : 0,
      costInput: row.HasCost === 1 ? null : costInputOf(row),
    }));
  }

  async findOwnerSpansMarked(input: {
    authorization: Authorization;
    traceId: string;
    braids: readonly BraidWindowRead[];
  }): Promise<(TraceSpanSummaryRecord & { braided: boolean })[]> {
    const result = await this.reader.read({
      statement: ownerSpansMarkedStatement(input),
      table: storedSpans.$table.name,
      idBound: { occurredAtHint: null, fallback: "unbounded", openEnded: true },
    });
    const rows: unknown = result.rows;
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

/**
 * The braid dialog's and the Braids page's statements (ADR-183 §7). Each reads one project
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
  TraceBraidReadsRepository,
  type BraidActivityRead,
  type BraidConditionRead,
  type BraidOwnerTraceCounts,
} from "../trace-braid-reads.repository.ts";
import type { TraceSpanSummaryRecord } from "../trace-projected-read.repository.ts";
import { ClickHouseTraceSpanRepository } from "./trace-span.repository.ts";

const count = z.coerce.number().int().min(0);
const traceIdRowsSchema = z.array(z.looseObject({ TraceId: z.string() }));
const ownerCountsRowsSchema = z.array(
  z.looseObject({ every: count, some: count, unsigned: count.optional() }),
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

  async countOwnerSpansInTraces(input: {
    authorization: Authorization;
    traceIds: readonly string[];
    sinceMs: number;
    fromMs: number;
    condition: BraidConditionRead;
  }): Promise<BraidOwnerTraceCounts> {
    const { compiledWhere, readerProjectId: reader } = input.condition;
    const matched = conditionSql({ compiledWhere, reader, prefix: "braid" });
    const split = verifiedPartsOf(compiledWhere);
    const signed = split.kind === "signed" ? split : null;
    const rest = conditionSql({ compiledWhere: signed?.rest, reader, prefix: "braidRest" });
    const verified = signed
      ? conditionSql({ compiledWhere: signed.verified, reader, prefix: "braidSigned" })
      : null;
    const inWindow = `StartTime >= ${millis("braidFromMs")}`;
    const unsignedColumn = verified
      ? `,\n            argMax(${inWindow} AND ${rest.sql} AND NOT ${verified.sql}, UpdatedAt) AS u`
      : "";
    const client = this.clickhouse.as(input.authorization, { reads: "traces" });
    const result = await client.query({
      // ID_BOUND_SKIP: bounded by the reader's trace ids and the 7-day StartTime floor.
      query: `
        SELECT
          countIf(spans > 0 AND matched = spans) AS every,
          countIf(matched > 0 AND matched < spans) AS some${verified ? ",\n          sum(unsigned) AS unsigned" : ""}
        FROM (
          SELECT TraceId, count() AS spans, sum(m) AS matched${verified ? ", sum(u) AS unsigned" : ""}
          FROM (
            SELECT TraceId, SpanId,
              argMax(${inWindow} AND ${matched.sql}, UpdatedAt) AS m${unsignedColumn}
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
        braidFromMs: input.fromMs,
        ...matched.params,
        ...rest.params,
        ...verified?.params,
      },
      format: "JSONEachRow",
    });
    const [row] = ownerCountsRowsSchema.parse(await result.json());
    return { every: row?.every ?? 0, some: row?.some ?? 0, unsigned: row?.unsigned ?? 0 };
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

  async findOwnerSpansMarked(input: {
    authorization: Authorization;
    traceId: string;
    fromMs: number;
    condition: BraidConditionRead;
  }): Promise<(TraceSpanSummaryRecord & { braided: boolean })[]> {
    const { compiledWhere, readerProjectId: reader } = input.condition;
    const matched = conditionSql({ compiledWhere, reader, prefix: "braid" });
    const client = this.clickhouse.as(input.authorization, { reads: "traces" });
    const result = await client.query({
      query: `
        SELECT ${ClickHouseTraceSpanRepository.summarySelect},
          (StartTime >= ${millis("braidFromMs")} AND ${matched.sql}) AS Braided
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
      query_params: { traceId: input.traceId, braidFromMs: input.fromMs, ...matched.params },
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

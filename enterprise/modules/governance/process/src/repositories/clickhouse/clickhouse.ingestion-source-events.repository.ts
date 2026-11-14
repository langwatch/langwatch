// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { clickhouseRead, fn, tenantScope } from "@langwatch/clickhouse-client/builder";
import {
  type ActivityEventDetailRow,
  GOVERNANCE_ATTR,
  GOVERNANCE_ORIGIN_KIND_VALUE,
} from "@langwatch/enterprise-governance-contract";
import { z } from "zod";

import type {
  GovernanceClickHouseReadClient,
  GovernanceClickHouseReadResolver,
} from "../governance.repositories.ts";
import type {
  IngestionSourceEventsRepository,
  SourceEventWindows,
} from "../ingestion-source-events.repository.ts";
import { governanceOcsfEvents as events } from "./clickhouse.governance-ocsf-events.table.ts";
import { storedLogRecords as logs } from "./clickhouse.stored-log-records.table.ts";

const ATTR_ORIGIN_KIND = GOVERNANCE_ATTR.ORIGIN_KIND;
const ATTR_INGESTION_SOURCE_ID = GOVERNANCE_ATTR.INGESTION_SOURCE_ID;
const ORIGIN_KIND_VALUE = GOVERNANCE_ORIGIN_KIND_VALUE;

const ZERO_PULLED_USAGE = {
  cost_usd: "0",
  tokens_input: 0,
  tokens_output: 0,
};

/**
 * Usage on a stored pulled OCSF row's `metadata.extension`, parsed because an adapter's `extra`
 * can land anything there: each field falls back to 0 alone. Not `.nonnegative()`: a credit
 * line is a reported figure on the audit record and must show, not read as 0.
 */
const pulledUsageExtensionSchema = z
  .object({
    cost_usd: z
      .union([z.string(), z.number()])
      .transform((v) => {
        const s = String(v).trim();
        return s !== "" && Number.isFinite(Number(s)) ? s : "0";
      })
      .catch("0"),
    tokens_input: z.coerce.number().finite().catch(0),
    tokens_output: z.coerce.number().finite().catch(0),
  })
  .catch(ZERO_PULLED_USAGE);

/** The 24h/7d/30d counters plus newest timestamp one table contributes. */
type WindowCountRow = {
  c24: number | string;
  c7: number | string;
  c30: number | string;
  lastMs: string | null;
};

/** A pulled event is one a puller wrote under the synthetic `pull:` trace id. */
const PULLED_TRACE_PREFIX = "pull:";

type WindowCountArgs = {
  ch: GovernanceClickHouseReadClient;
  tenantId: string;
  sourceId: string;
  since24h: number;
  since7d: number;
  since30d: number;
};

type SourceCountArgs = {
  ch: GovernanceClickHouseReadClient;
  tenantId: string;
  sourceIds: readonly string[];
  since: number;
};

/**
 * A source's pulled OCSF events and pushed log records, read as built reads (ADR-202) on the
 * governance project's tenant. Spec: specs/ai-gateway/governance/folds.feature
 */
export class ClickHouseIngestionSourceEventsRepository implements IngestionSourceEventsRepository {
  private constructor(private readonly clickhouse: GovernanceClickHouseReadResolver) {}

  static create(
    clickhouse: GovernanceClickHouseReadResolver,
  ): ClickHouseIngestionSourceEventsRepository {
    return new ClickHouseIngestionSourceEventsRepository(clickhouse);
  }

  async countLoggedAndPulledEventsBySource(input: {
    organizationId: string;
    tenantId: string;
    sourceIds: readonly string[];
    sinceMs: number;
  }): Promise<{ sourceId: string; count: number }[]> {
    const args: SourceCountArgs = {
      ch: await this.clickhouse(input.tenantId),
      tenantId: input.tenantId,
      sourceIds: input.sourceIds,
      since: input.sinceMs,
    };
    const counts = await Promise.all([
      ClickHouseIngestionSourceEventsRepository.countLoggedEventsBySource(args),
      ClickHouseIngestionSourceEventsRepository.countPulledEventsBySource(args),
    ]);
    return counts.flat().map((row) => ({ sourceId: row.sourceId, count: Number(row.c) }));
  }

  private static async countLoggedEventsBySource(
    args: SourceCountArgs,
  ): Promise<{ sourceId: string; c: string }[]> {
    if (args.sourceIds.length === 0) return [];
    const sourceOf = fn.mapGet(logs.Attributes, ATTR_INGESTION_SOURCE_ID);
    const statement = clickhouseRead({ scope: tenantScope.single({ tenantId: args.tenantId }) })
      .from(logs)
      .select({ sourceId: sourceOf, c: fn.toString(fn.count()) })
      .where(({ and, eq, gte, oneOf }) =>
        and(
          gte(logs.TimeUnixMs, args.since),
          eq(fn.mapGet(logs.Attributes, ATTR_ORIGIN_KIND), ORIGIN_KIND_VALUE),
          oneOf(sourceOf, args.sourceIds),
        ),
      )
      .groupBy(sourceOf)
      .build();
    return (await args.ch.read({ statement })).rows;
  }

  private static async countPulledEventsBySource(
    args: SourceCountArgs,
  ): Promise<{ sourceId: string; c: string }[]> {
    if (args.sourceIds.length === 0) return [];
    const statement = clickhouseRead({ scope: tenantScope.single({ tenantId: args.tenantId }) })
      .from(events)
      .select({ sourceId: events.SourceId, c: fn.toString(fn.count()) })
      .where(({ and, gte, oneOf }) =>
        and(
          fn.startsWith(events.TraceId, PULLED_TRACE_PREFIX),
          gte(events.EventTime, args.since),
          oneOf(events.SourceId, args.sourceIds),
        ),
      )
      // TraceId, SourceId and EventTime are the event's own: they never change across versions.
      .latestVersion({ repeat: [events.TraceId, events.SourceId, events.EventTime] })
      .groupBy(events.SourceId)
      .build();
    return (await args.ch.read({ statement })).rows;
  }

  /** Rows a puller wrote to `governance_ocsf_events` under the synthetic `pull:` trace id. */
  async findPulledEventsForSource(input: {
    organizationId: string;
    tenantId: string;
    sourceId: string;
    beforeMs: number;
    limit: number;
  }): Promise<ActivityEventDetailRow[]> {
    const ch = await this.clickhouse(input.tenantId);
    const statement = clickhouseRead({ scope: tenantScope.single({ tenantId: input.tenantId }) })
      .from(events)
      .select({
        eventId: events.EventId,
        eventType: events.SourceType,
        actorUserId: events.ActorUserId,
        actorEmail: events.ActorEmail,
        actorEnduserId: events.ActorEnduserId,
        action: events.ActionName,
        target: events.TargetName,
        occurredMs: fn.toString(fn.toUnixTimestamp64Milli(events.EventTime)),
        createdMs: fn.toString(fn.toUnixTimestamp64Milli(events.CreatedAt)),
        rawPayload: events.RawOcsfJson,
      })
      .where(({ and, eq, lt }) =>
        and(
          fn.startsWith(events.TraceId, PULLED_TRACE_PREFIX),
          eq(events.SourceId, input.sourceId),
          lt(events.EventTime, input.beforeMs),
        ),
      )
      // TraceId, SourceId and EventTime are the event's own: they never change across versions.
      .latestVersion({ repeat: [events.TraceId, events.SourceId, events.EventTime] })
      .orderBy(events.EventTime, "DESC")
      .orderBy(events.EventId, "DESC")
      .limit(input.limit)
      .build();
    const { rows } = await ch.read({ statement });
    return rows.map((row) => ClickHouseIngestionSourceEventsRepository.toPulledEvent(row));
  }

  async findLoggedAndPulledEventWindows(input: {
    organizationId: string;
    tenantId: string;
    sourceId: string;
    since24h: number;
    since7d: number;
    since30d: number;
  }): Promise<SourceEventWindows[]> {
    const args: WindowCountArgs = {
      ch: await this.clickhouse(input.tenantId),
      tenantId: input.tenantId,
      sourceId: input.sourceId,
      since24h: input.since24h,
      since7d: input.since7d,
      since30d: input.since30d,
    };
    const windows = await Promise.all([
      ClickHouseIngestionSourceEventsRepository.loggedEventWindowCounts(args),
      ClickHouseIngestionSourceEventsRepository.pulledEventWindowCounts(args),
    ]);
    return windows
      .filter((row): row is WindowCountRow => row !== undefined)
      .map((row) => ({
        c24: Number(row.c24 ?? 0),
        c7: Number(row.c7 ?? 0),
        c30: Number(row.c30 ?? 0),
        lastMs: row.lastMs ? Number(row.lastMs) : 0,
      }));
  }

  private static async loggedEventWindowCounts(
    args: WindowCountArgs,
  ): Promise<WindowCountRow | undefined> {
    const scope = tenantScope.single({ tenantId: args.tenantId });
    const ofSource = () =>
      [
        fn.mapGet(logs.Attributes, ATTR_ORIGIN_KIND),
        fn.mapGet(logs.Attributes, ATTR_INGESTION_SOURCE_ID),
      ] as const;
    const statement = clickhouseRead({ scope })
      .from(logs)
      .select(({ gte, scalar, and, eq }) => ({
        c24: fn.countIf(gte(logs.TimeUnixMs, args.since24h)),
        c7: fn.countIf(gte(logs.TimeUnixMs, args.since7d)),
        c30: fn.count(),
        lastMs: scalar((sub) =>
          sub
            .from(logs)
            .select({ lastMs: fn.toString(fn.toUnixTimestamp64Milli(fn.max(logs.TimeUnixMs))) })
            .where(() => {
              const [origin, source] = ofSource();
              return and(eq(origin, ORIGIN_KIND_VALUE), eq(source, args.sourceId));
            }),
        ),
      }))
      .where(({ and, eq, gte }) => {
        const [origin, source] = ofSource();
        return and(
          gte(logs.TimeUnixMs, args.since30d),
          eq(origin, ORIGIN_KIND_VALUE),
          eq(source, args.sourceId),
        );
      })
      .build();
    return (await args.ch.read({ statement })).rows[0];
  }

  private static async pulledEventWindowCounts(
    args: WindowCountArgs,
  ): Promise<WindowCountRow | undefined> {
    const scope = tenantScope.single({ tenantId: args.tenantId });
    const statement = clickhouseRead({ scope })
      .from(events)
      .select(({ gte, scalar, and, eq }) => ({
        c24: fn.countIf(gte(events.EventTime, args.since24h)),
        c7: fn.countIf(gte(events.EventTime, args.since7d)),
        c30: fn.count(),
        lastMs: scalar((sub) =>
          sub
            .from(events)
            .select({ lastMs: fn.toString(fn.toUnixTimestamp64Milli(fn.max(events.EventTime))) })
            .where(() =>
              and(
                fn.startsWith(events.TraceId, PULLED_TRACE_PREFIX),
                eq(events.SourceId, args.sourceId),
              ),
            ),
        ),
      }))
      .where(({ and, eq, gte }) =>
        and(
          fn.startsWith(events.TraceId, PULLED_TRACE_PREFIX),
          eq(events.SourceId, args.sourceId),
          gte(events.EventTime, args.since30d),
        ),
      )
      // TraceId, SourceId and EventTime are the event's own: they never change across versions.
      .latestVersion({ repeat: [events.TraceId, events.SourceId, events.EventTime] })
      .build();
    return (await args.ch.read({ statement })).rows[0];
  }

  private static pulledUsageFromRawOcsf(rawPayload: string): {
    costUsd: string;
    tokensInput: number;
    tokensOutput: number;
  } {
    let extension: unknown;
    try {
      extension = (JSON.parse(rawPayload) as { metadata?: { extension?: unknown } })?.metadata
        ?.extension;
    } catch {
      extension = null;
    }
    const usage = pulledUsageExtensionSchema.parse(extension ?? {});
    return {
      costUsd: usage.cost_usd,
      tokensInput: usage.tokens_input,
      tokensOutput: usage.tokens_output,
    };
  }

  private static toPulledEvent(row: {
    eventId: string;
    eventType: string;
    actorUserId: string;
    actorEmail: string;
    actorEnduserId: string;
    action: string;
    target: string;
    occurredMs: string;
    createdMs: string;
    rawPayload: string;
  }): ActivityEventDetailRow {
    return {
      eventId: row.eventId,
      eventType: row.eventType ?? "",
      actor: row.actorEmail || row.actorUserId || row.actorEnduserId || "",
      action: row.action ?? "",
      target: row.target ?? "",
      ...ClickHouseIngestionSourceEventsRepository.pulledUsageFromRawOcsf(row.rawPayload),
      eventTimestampIso: new Date(Number(row.occurredMs)).toISOString(),
      ingestedAtIso: new Date(Number(row.createdMs)).toISOString(),
      rawPayload: row.rawPayload,
    };
  }
}

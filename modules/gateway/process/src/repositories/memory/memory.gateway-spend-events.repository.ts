import {
  nanoUsdToDecimalString,
  parseSummedNanoUsd,
  SPEND_STATUS_IN_FLIGHT,
  type GatewaySpendDay,
  type GatewayUsageCount,
  type SpendBucket,
  type SpendEventRow,
  type SpendFilters,
  type SpendGroupByKey,
} from "@langwatch/gateway-contract";
import { Temporal } from "@langwatch/time";

import type { GatewaySpendState } from "../../eventing/gateway-spend.projection.ts";
import * as spendCursors from "../../rules/gateway-spend-cursor.rules.ts";
import { normalizeStatusFilter } from "../../rules/gateway-spend-filters.rules.ts";
import { EMPTY_SPEND_USAGE } from "../../rules/gateway-spend-projection.rules.ts";
import {
  GatewaySpendEventsRepository,
  type SpendEventsPageCursor,
  type SpendSummaryRow,
} from "../gateway-spend-events.repository.ts";

/** One request at its latest committed version, as the replacing table collapses it. */
type MemoryGatewaySpendRow = Readonly<{
  tenantId: string;
  gatewayRequestId: string;
  state: GatewaySpendState;
}>;

const CHARGED = new Set(["confirmed", "failed"]);
const DAY_MS = 86_400_000;
const NANO_PER_USD = 1_000_000_000;

const COLUMN_BY_KEY: Record<SpendGroupByKey, (row: SpendEventRow) => string> = {
  virtual_key: (row) => row.virtualKeyId,
  end_user: (row) => row.endUserId,
  project: (row) => row.tenantId,
  model: (row) => row.model,
  provider: (row) => row.providerKey,
  principal: (row) => row.principalUserId,
  request_type: (row) => row.requestType,
};

/**
 * The per-request spend record in memory: one row per request at its latest
 * version, read back the way the live table answers (an admission written
 * with no status reads as admitted, usage absent unless measured or charged).
 */
export class MemoryGatewaySpendEventsRepository extends GatewaySpendEventsRepository {
  static create(): MemoryGatewaySpendEventsRepository {
    return new MemoryGatewaySpendEventsRepository();
  }

  readonly #rows = new Map<string, MemoryGatewaySpendRow>();

  private constructor() {
    super();
  }

  /** Every request at its latest version as the table reads it, for the settlement sweep's twin. */
  latestRows(): SpendEventRow[] {
    return [...this.#rows.values()].map(toSpendEventRow);
  }

  async upsertFromFold(
    entries: { tenantId: string; gatewayRequestId: string; state: GatewaySpendState }[],
  ): Promise<void> {
    const tenantId = entries[0]?.tenantId;
    if (entries.some((entry) => entry.tenantId !== tenantId)) {
      throw new Error(
        "MemoryGatewaySpendEventsRepository.upsertFromFold: entries span multiple tenants",
      );
    }
    for (const entry of entries) {
      const key = JSON.stringify([entry.tenantId, entry.gatewayRequestId]);
      const current = this.#rows.get(key);
      if (current && current.state.updatedAt > entry.state.updatedAt) continue;
      this.#rows.set(key, {
        tenantId: entry.tenantId,
        gatewayRequestId: entry.gatewayRequestId,
        state: structuredClone(entry.state),
      });
    }
  }

  async findForFold(input: {
    tenantId: string;
    gatewayRequestId: string;
  }): Promise<GatewaySpendState | null> {
    const stored = this.#rows.get(JSON.stringify([input.tenantId, input.gatewayRequestId]));
    if (!stored) return null;
    const row = toSpendEventRow(stored);
    const { state } = stored;

    return {
      ...structuredClone(state),
      status: row.status,
      usage: usageReadsBack(state, row.status) ? { ...(state.usage ?? EMPTY_SPEND_USAGE) } : null,
      occurredAtMs: row.occurredAt.epochMilliseconds,
    };
  }

  async readSpendEventsPage(input: {
    tenantId: string;
    fromMs: number;
    toMs: number;
    filters?: SpendFilters;
    cursor?: SpendEventsPageCursor;
    limit?: number;
  }): Promise<{ rows: SpendEventRow[]; nextCursor: SpendEventsPageCursor | null }> {
    const limit = input.limit ?? 50;
    const { cursor } = input;
    const rows = this.#read([input.tenantId])
      .filter(
        (row) =>
          inWindow(row, input.fromMs, input.toMs) &&
          matchesFilters(row, input.filters ?? {}) &&
          (!cursor ||
            compareTuple(
              [row.occurredAt.epochMilliseconds, row.gatewayRequestId],
              [cursor.occurredAtMs, cursor.gatewayRequestId],
            ) < 0),
      )
      .toSorted((left, right) =>
        compareTuple(
          [right.occurredAt.epochMilliseconds, right.gatewayRequestId],
          [left.occurredAt.epochMilliseconds, left.gatewayRequestId],
        ),
      )
      .slice(0, limit);
    const last = rows.at(-1);

    return {
      rows,
      nextCursor:
        rows.length === limit && last
          ? {
              occurredAtMs: last.occurredAt.epochMilliseconds,
              gatewayRequestId: last.gatewayRequestId,
            }
          : null,
    };
  }

  async walkSpendEvents(input: {
    tenantIds: string[];
    fromMs?: number;
    toMs?: number;
    cursor?: string | null;
    limit: number;
    filters?: SpendFilters;
  }): Promise<{ rows: SpendEventRow[]; nextCursor: string | null }> {
    if (input.tenantIds.length === 0) return { rows: [], nextCursor: null };
    const decoded = input.cursor ? spendCursors.decodeSpendEventsCursor(input.cursor) : null;
    const page = [...this.#rows.values()]
      .filter((stored) => input.tenantIds.includes(stored.tenantId))
      .map((stored) => ({ stored, row: toSpendEventRow(stored) }))
      .filter(
        ({ stored, row }) =>
          (input.fromMs === undefined || row.occurredAt.epochMilliseconds >= input.fromMs) &&
          (input.toMs === undefined || row.occurredAt.epochMilliseconds < input.toMs) &&
          matchesFilters(row, input.filters ?? {}) &&
          (!decoded ||
            compareTuple(
              [stored.state.updatedAt, row.gatewayRequestId],
              [decoded.eventTimestampMs, decoded.gatewayRequestId],
            ) > 0),
      )
      .toSorted((left, right) =>
        compareTuple(
          [left.stored.state.updatedAt, left.row.gatewayRequestId],
          [right.stored.state.updatedAt, right.row.gatewayRequestId],
        ),
      )
      .slice(0, input.limit);
    const last = page.at(-1);

    return {
      rows: page.map(({ row }) => row),
      nextCursor:
        page.length === input.limit && last
          ? spendCursors.encodeSpendEventsCursor({
              eventTimestampMs: last.stored.state.updatedAt,
              gatewayRequestId: last.row.gatewayRequestId,
            })
          : null,
    };
  }

  async readSpendSummaries(input: {
    tenantIds: string[];
    groupBy: SpendGroupByKey[];
    bucket?: SpendBucket;
    timezone?: string;
    fromMs: number;
    toMs: number;
    cursor?: string | null;
    limit?: number;
    filters?: SpendFilters;
  }): Promise<{ rows: SpendSummaryRow[]; nextCursor: string | null }> {
    const filters = input.filters ?? {};
    if (
      filters.status !== undefined &&
      normalizeStatusFilter(filters.status) === SPEND_STATUS_IN_FLIGHT
    ) {
      throw new Error(
        `readSpendSummaries cannot narrow to "${SPEND_STATUS_IN_FLIGHT}": rollups exclude in-flight rows, so the read would always be empty`,
      );
    }
    if (input.tenantIds.length === 0) return { rows: [], nextCursor: null };
    const bucket = input.bucket ?? "none";
    const timezone = input.timezone ?? "UTC";
    const limit = input.limit ?? 500;
    const dimensions = (row: SpendEventRow): string[] => [
      ...(bucket === "none" ? [] : [bucketStartOf(row, bucket, timezone)]),
      ...input.groupBy.map((key) => COLUMN_BY_KEY[key](row)),
    ];
    const cursor = input.cursor ? spendCursors.decodeSpendSummariesCursor(input.cursor) : null;
    const arity = input.groupBy.length + (bucket === "none" ? 0 : 1);
    if (cursor !== null && cursor.length !== arity) {
      throw new Error(
        `cursor names a walk over ${cursor.length} dimension(s); this request groups by ${arity}`,
      );
    }

    const groups = groupedRows({
      rows: this.#read(input.tenantIds),
      keep: (row) => inWindow(row, input.fromMs, input.toMs) && matchesFilters(row, filters),
      dimensions,
      cursor,
    });
    const page = [...groups.values()]
      .toSorted((left, right) => compareTuple(left.parts, right.parts))
      .slice(0, limit);
    const last = page.at(-1);

    return {
      rows: page.map(({ parts, rows }) => summaryOf({ parts, rows, input: { ...input, bucket } })),
      nextCursor:
        page.length === limit && last ? spendCursors.encodeSpendSummariesCursor(last.parts) : null,
    };
  }

  async sumCostNanoUsdByRequestType(input: {
    tenantIds: string[];
    requestType: string;
    fromMs?: number;
    toMs?: number;
  }): Promise<number> {
    const nano = this.#read(input.tenantIds)
      .filter(
        (row) =>
          row.requestType === input.requestType &&
          row.status === "confirmed" &&
          (input.fromMs === undefined || row.occurredAt.epochMilliseconds >= input.fromMs) &&
          (input.toMs === undefined || row.occurredAt.epochMilliseconds < input.toMs),
      )
      .reduce((sum, row) => sum + BigInt(row.costNanoUsd), 0n);
    return parseSummedNanoUsd(nano);
  }

  async readEndUserSpend(input: {
    tenantIds: string[];
    endUserId: string;
    fromMs: number;
    toMs: number;
    virtualKeyId?: string;
  }): Promise<{
    spendUsd: string;
    spendNanoUsd: number;
    requestCount: number;
    tokensInput: number;
    tokensOutput: number;
    tokensCacheRead: number;
    tokensCacheWrite: number;
    tokensReasoning: number;
    tokensInputImage: number;
    tokensOutputImage: number;
    imageCount: number;
  }> {
    const rows = this.#read(input.tenantIds).filter(
      (row) =>
        row.endUserId === input.endUserId &&
        inWindow(row, input.fromMs, input.toMs) &&
        (input.virtualKeyId === undefined || row.virtualKeyId === input.virtualKeyId),
    );
    const nano = parseSummedNanoUsd(rows.reduce((sum, row) => sum + BigInt(row.costNanoUsd), 0n));
    const total = (pick: (row: SpendEventRow) => number) =>
      rows.reduce((sum, row) => sum + pick(row), 0);

    return {
      spendUsd: nanoUsdToDecimalString(nano),
      spendNanoUsd: nano,
      requestCount: rows.length,
      tokensInput: total((row) => row.tokensInput),
      tokensOutput: total((row) => row.tokensOutput),
      tokensCacheRead: total((row) => row.tokensCacheRead),
      tokensCacheWrite: total((row) => row.tokensCacheWrite),
      tokensReasoning: total((row) => row.tokensReasoning),
      tokensInputImage: total((row) => row.tokensInputImage),
      tokensOutputImage: total((row) => row.tokensOutputImage),
      imageCount: total((row) => row.imageCount),
    };
  }

  async sumDaysForOrganizationProjects(input: {
    tenantIds: readonly string[];
    fromDay: string;
    toDay: string;
  }): Promise<GatewaySpendDay[]> {
    if (input.tenantIds.length === 0) return [];
    const fromMs = utcDayStartMs(input.fromDay);
    const toMs = utcDayStartMs(input.toDay) + DAY_MS;
    const byDay = new Map<string, SpendEventRow[]>();
    for (const row of this.#read(input.tenantIds)) {
      if (!inWindow(row, fromMs, toMs)) continue;
      const day = row.occurredAt.toZonedDateTimeISO("UTC").toPlainDate().toString();
      byDay.set(day, [...(byDay.get(day) ?? []), row]);
    }

    return [...byDay.entries()]
      .toSorted(([left], [right]) => compareTuple([left], [right]))
      .map(([day, rows]) => {
        const charged = rows.filter((row) => CHARGED.has(row.status));
        const tokens = (row: SpendEventRow) =>
          row.tokensInput +
          row.tokensOutput +
          row.tokensCacheRead +
          row.tokensCacheWrite +
          row.tokensReasoning;
        return {
          day,
          amountNanoUsd: parseSummedNanoUsd(
            charged.reduce((sum, row) => sum + BigInt(row.costNanoUsd), 0n),
          ),
          requestCount: charged.length,
          pricedRequestCount: charged.filter((row) => row.costNanoUsd > 0).length,
          requestsWithoutAmount:
            charged.filter((row) => row.costNanoUsd === 0 && tokens(row) > 0).length +
            rows.filter((row) => row.status === "settled").length,
        };
      });
  }

  async countUsage(input: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<GatewayUsageCount> {
    const projects = [...new Set(input.projectIds)];
    const rows = this.#read(projects);
    const counted = rows.filter(
      (row) => input.since === undefined || row.occurredAt.epochMilliseconds >= input.since,
    );
    const firsts = projects.flatMap((projectId) => {
      const own = rows.filter((row) => row.tenantId === projectId);
      return own.length === 0
        ? []
        : [Math.min(...own.map((row) => row.occurredAt.epochMilliseconds))];
    });

    return {
      requests: counted.length,
      spendUsd: projects.reduce(
        (sum, projectId) =>
          sum +
          counted
            .filter((row) => row.tenantId === projectId)
            .reduce((total, row) => total + row.costNanoUsd, 0) /
            NANO_PER_USD,
        0,
      ),
      ...(firsts.length === 0 ? {} : { firstRequestAt: Math.min(...firsts) }),
    };
  }

  #read(tenantIds: readonly string[]): SpendEventRow[] {
    const tenants = new Set(tenantIds);
    return [...this.#rows.values()]
      .filter((stored) => tenants.has(stored.tenantId))
      .map(toSpendEventRow);
  }
}

/** A stored request as the table reads it back: one row, quantities as columns. */
function toSpendEventRow(stored: MemoryGatewaySpendRow): SpendEventRow {
  const { state } = stored;
  const usage = state.usage ?? EMPTY_SPEND_USAGE;
  return {
    tenantId: stored.tenantId,
    gatewayRequestId: stored.gatewayRequestId,
    organizationId: state.organizationId,
    teamId: "",
    virtualKeyId: state.virtualKeyId,
    principalUserId: state.principalUserId,
    endUserId: state.endUserId,
    traceId: state.traceId,
    model: state.model,
    providerKey: state.providerKey,
    requestType: state.requestType,
    tokensInput: usage.input_tokens,
    tokensOutput: usage.output_tokens,
    tokensCacheRead: usage.cache_read_input_tokens,
    tokensCacheWrite: usage.cache_creation_input_tokens,
    tokensReasoning: usage.reasoning_tokens,
    tokensInputImage: usage.input_image_tokens,
    tokensOutputImage: usage.output_image_tokens,
    imageCount: usage.image_count,
    costNanoUsd: state.costNanoUsd,
    costUsd: nanoUsdToDecimalString(state.costNanoUsd),
    rateVersion: state.rateVersion,
    status: state.status === "" ? "admitted" : state.status,
    errorClass: state.errorType,
    httpStatus: state.httpStatus,
    needsReconciliation: state.needsReconciliation,
    settleReason: state.settleReason,
    labels: [...state.labels],
    metadata: state.metadataJson,
    durationMs: state.durationMs,
    occurredAt: Temporal.Instant.fromEpochMilliseconds(
      state.occurredAtMs || state.LastEventOccurredAt,
    ),
  };
}

/** Whether usage reads back at all: it is absent when nothing was measured and nothing charged. */
function usageReadsBack(state: GatewaySpendState, status: string): boolean {
  const usage = state.usage ?? EMPTY_SPEND_USAGE;
  const measured = [
    usage.input_tokens,
    usage.output_tokens,
    usage.input_chars,
    usage.audio_ms,
    usage.input_audio_tokens,
    usage.output_audio_tokens,
    usage.cache_creation_1h_tokens,
    usage.input_image_tokens,
    usage.output_image_tokens,
    usage.image_count,
  ].some((quantity) => quantity > 0);
  return CHARGED.has(status) || measured;
}

/** Charged and settled rows grouped by their dimensions, only groups after the cursor. */
function groupedRows(input: {
  rows: SpendEventRow[];
  keep: (row: SpendEventRow) => boolean;
  dimensions: (row: SpendEventRow) => string[];
  cursor: string[] | null;
}): Map<string, { parts: string[]; rows: SpendEventRow[] }> {
  const groups = new Map<string, { parts: string[]; rows: SpendEventRow[] }>();
  const settledOrCharged = input.rows.filter(
    (row) => row.status !== SPEND_STATUS_IN_FLIGHT && input.keep(row),
  );
  for (const row of settledOrCharged) {
    const parts = input.dimensions(row);
    if (input.cursor !== null && compareTuple(parts, input.cursor) <= 0) continue;
    const key = JSON.stringify(parts);
    const group = groups.get(key) ?? { parts, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return groups;
}

function inWindow(row: SpendEventRow, fromMs: number, toMs: number): boolean {
  const at = row.occurredAt.epochMilliseconds;
  return at >= fromMs && at < toMs;
}

/** The filters the live read turns into predicates; a present-but-empty list matches nothing. */
function matchesFilters(row: SpendEventRow, filters: SpendFilters): boolean {
  const within = (values: string[] | undefined, value: string) =>
    values === undefined || values.includes(value);
  if (!within(filters.virtualKeyIds, row.virtualKeyId)) return false;
  if (!within(filters.endUserIds, row.endUserId)) return false;
  if (!within(filters.principalUserIds, row.principalUserId)) return false;
  if (!within(filters.models, row.model)) return false;
  if (!within(filters.providerKeys, row.providerKey)) return false;
  if (!within(filters.requestTypes, row.requestType)) return false;
  const labels = filters.labels;
  if (labels !== undefined && !row.labels.some((label) => labels.includes(label))) return false;
  const metadata = metadataMapOf(row.metadata);
  const metadataMisses = (filter: { key: string; values: string[] }) =>
    !filter.values.includes(metadata.get(filter.key) ?? "");
  if (filters.metadata?.some(metadataMisses)) return false;
  const status = filters.status === undefined ? undefined : normalizeStatusFilter(filters.status);
  return status === undefined || row.status === status;
}

/** The string-valued pairs of the caller's metadata, as the table's map column holds them. */
function metadataMapOf(raw: string): Map<string, string> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return new Map();
    return new Map(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return new Map();
  }
}

function bucketStartOf(row: SpendEventRow, bucket: Exclude<SpendBucket, "none">, timezone: string) {
  const clock = row.occurredAt.toZonedDateTimeISO(timezone);
  const day = clock.toPlainDate().toString();
  return bucket === "hour" ? `${day}T${String(clock.hour).padStart(2, "0")}:00:00` : day;
}

function summaryOf({
  parts,
  rows,
  input,
}: {
  parts: string[];
  rows: SpendEventRow[];
  input: { groupBy: SpendGroupByKey[]; bucket: SpendBucket };
}): SpendSummaryRow {
  const keys = input.bucket === "none" ? parts : parts.slice(1);
  const charged = rows.filter((row) => CHARGED.has(row.status));
  const total = (pick: (row: SpendEventRow) => number) =>
    charged.reduce((sum, row) => sum + pick(row), 0);
  const nano = parseSummedNanoUsd(charged.reduce((sum, row) => sum + BigInt(row.costNanoUsd), 0n));

  return {
    key: keys[0] ?? "",
    group: Object.fromEntries(input.groupBy.map((key, index) => [key, keys[index] ?? ""])),
    bucketStart: input.bucket === "none" ? null : (parts[0] ?? ""),
    eventCount: charged.length,
    settledCount: rows.filter((row) => row.status === "settled").length,
    tokensInput: total((row) => row.tokensInput),
    tokensOutput: total((row) => row.tokensOutput),
    tokensCacheRead: total((row) => row.tokensCacheRead),
    tokensCacheWrite: total((row) => row.tokensCacheWrite),
    tokensReasoning: total((row) => row.tokensReasoning),
    tokensInputImage: total((row) => row.tokensInputImage),
    tokensOutputImage: total((row) => row.tokensOutputImage),
    imageCount: total((row) => row.imageCount),
    costNanoUsd: nano,
    costUsd: nanoUsdToDecimalString(nano),
  };
}

/** Tuple order: numbers compared by value, strings by code unit, as the columns compare. */
function compareTuple(
  left: readonly (string | number)[],
  right: readonly (string | number)[],
): number {
  for (const [index, part] of left.entries()) {
    const other = right[index]!;
    if (part !== other) return part < other ? -1 : 1;
  }
  return 0;
}

function utcDayStartMs(day: string): number {
  return Temporal.Instant.from(`${day}T00:00:00.000Z`).epochMilliseconds;
}

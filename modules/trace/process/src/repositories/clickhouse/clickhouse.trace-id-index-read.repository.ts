import type { Authorization } from "@langwatch/authorization";
import {
  type ClickHouseQueryClient,
  type IdIndexFlags,
  idIndexMissWindow,
  indexedRead,
  indexWindow,
  ownProjectIdOf,
  type TenantScopedReader,
  type WindowFallback,
  type WindowFragment,
} from "@langwatch/clickhouse-client";

import {
  TraceIdIndexReadRepository,
  type TraceIdIndexSource,
  type TraceIdIndexWindow,
} from "../trace-id-index-read.repository.ts";

/**
 * Trace's reads by trace id through its id indexes (goose 00110, id-index plan §4): fenced reads
 * run through `read`; reads on a plain client ask `findWindows` for the bound they then apply.
 */
export class ClickHouseTraceIdIndexReadRepository extends TraceIdIndexReadRepository {
  /** `clickhouse` answers `findWindows`; a repository using only `read` builds one without. */
  static create({
    clickhouse,
  }: { clickhouse?: ClickHouseQueryClient } = {}): ClickHouseTraceIdIndexReadRepository {
    return new ClickHouseTraceIdIndexReadRepository(clickhouse);
  }

  private constructor(private readonly clickhouse: ClickHouseQueryClient | undefined) {
    super();
  }

  async findWindows({
    tenantId,
    traceIds,
    source,
    idIndex,
  }: {
    tenantId: string;
    traceIds: readonly string[];
    source: TraceIdIndexSource;
    idIndex: IdIndexFlags | undefined;
  }): Promise<TraceIdIndexWindow[]> {
    const clickhouse = this.clickhouse;
    if (clickhouse === undefined || idIndex === undefined || traceIds.length === 0) return [];
    if (!idIndex.isOn({ target: await clickhouse.targetOf({ tenantId }) })) return [];
    const bounds = await clickhouse.indexBounds({
      tenantId,
      index: `${source}_id_index`,
      key: { TraceId: [...traceIds] },
    });
    // Unseen by a ready index: read the recent partitions only, like indexedRead's miss probe.
    const { fromMs, toMs } = bounds.n === 0 ? idIndexMissWindow() : indexWindow(bounds);
    return [{ fromMs, toMs }];
  }

  /**
   * One fenced read of a trace by id through a trace id index (id-index plan §4). Not ready, the
   * caller's own resolver may name a time first, as today; ready, the index names the bound.
   */
  async read<T>({
    authorization,
    reader,
    idIndex,
    table,
    index,
    traceId,
    occurredAtMs,
    resolveHint,
    fallback,
    isEmpty,
    run,
  }: {
    authorization: Authorization;
    reader: TenantScopedReader;
    idIndex: IdIndexFlags | undefined;
    table: string;
    index: string;
    traceId: string;
    occurredAtMs: number | null | undefined;
    resolveHint?: (() => Promise<number | undefined>) | undefined;
    fallback: WindowFallback;
    isEmpty: (result: T) => boolean;
    run: (window: WindowFragment | null) => Promise<T>;
  }): Promise<T> {
    const trusted = idIndex !== undefined && idIndex.isOn({ target: await reader.targetOf() });
    const hintMs =
      occurredAtMs ?? (trusted || resolveHint === undefined ? undefined : await resolveHint());
    return indexedRead<T>({
      client: reader,
      idIndex,
      tenantId: ownProjectIdOf({ authorization, reads: "traces" }),
      table,
      index,
      key: { TraceId: traceId },
      hintMs: hintMs ?? null,
      fallback,
      isEmpty,
      run,
    });
  }
}

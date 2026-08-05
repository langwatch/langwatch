import { describe, expect, it, vi } from "vitest";
import { METRIC_ROLLUP_INTERVAL_MS } from "~/server/event-sourcing/pipelines/metric-processing/schemas/constants";
import type { CanonicalMetricDataPoint } from "~/server/event-sourcing/pipelines/metric-processing/schemas/metricDataPoint";
import { MetricDataPointClickHouseRepository } from "../metric-data-point.clickhouse.repository";

function dataPoint(): CanonicalMetricDataPoint {
  return {
    tenantId: "project-1",
    organizationId: "organization-1",
    pointId: "a".repeat(64),
    seriesId: "b".repeat(64),
    resourceSchemaUrl: "",
    resourceAttributesJson: "[]",
    resourceAttributeKeys: [],
    scopeSchemaUrl: "",
    scopeName: "scope",
    scopeVersion: "",
    scopeAttributesJson: "[]",
    scopeAttributeKeys: [],
    metricName: "requests",
    metricDescription: "",
    metricUnit: "1",
    metricKind: "gauge",
    aggregationTemporality: "unspecified",
    isMonotonic: null,
    pointAttributesJson: "[]",
    pointAttributeKeys: [],
    startTimeUnixNano: "0",
    timeUnixNano: "1700000000000000000",
    timeUnixMs: 1_700_000_000_000,
    flags: 0,
    valueType: "double",
    valueInt: null,
    valueDouble: 1.5,
    count: null,
    sum: null,
    min: null,
    max: null,
    explicitBounds: [],
    bucketCounts: [],
    exponentialScale: null,
    exponentialZeroThreshold: null,
    zeroCount: null,
    positiveOffset: null,
    positiveBucketCounts: [],
    negativeOffset: null,
    negativeBucketCounts: [],
    summaryQuantilesJson: "[]",
    canonicalPayload: '{"point":{"value":1.5}}',
    canonicalSizeBytes: 23,
    occurredAt: 1_700_000_000_000,
    acceptedAt: 1_800_000_000_000,
  };
}

describe("MetricDataPointClickHouseRepository", () => {
  it("writes authoritative raw data before a payload-free shadow estimate", async () => {
    const insert = vi.fn<
      (args: { table: string; values: unknown[] }) => Promise<void>
    >(async () => {});
    const client = { insert } as never;
    const repository = new MetricDataPointClickHouseRepository({
      resolveClient: async () => client,
      resolveOrganizationClient: async () => client,
    });

    await repository.ensureDataPoint({ point: dataPoint(), retentionDays: 49 });

    expect(insert.mock.calls.map((call) => call[0].table)).toEqual([
      "metric_data_points",
      "metric_usage_estimates",
    ]);
    const raw = insert.mock.calls[0]![0].values[0] as Record<string, unknown>;
    expect(raw).toMatchObject({
      TenantId: "project-1",
      OccurredAt: new Date(1_700_000_000_000),
      AcceptedAt: new Date(1_800_000_000_000),
    });
    expect(raw).not.toHaveProperty("OrganizationId");
    expect(raw).not.toHaveProperty("WrittenAt");
    const shadow = insert.mock.calls[1]![0].values[0] as Record<
      string,
      unknown
    >;
    expect(shadow).toMatchObject({
      OrganizationId: "organization-1",
      TenantId: "project-1",
      PointId: "a".repeat(64),
      SeriesId: "b".repeat(64),
      MetricName: "requests",
      CanonicalSourceBytes: 23,
    });
    expect(Object.keys(shadow).sort()).toEqual(
      [
        "AcceptedHour",
        "AcceptedAt",
        "CanonicalSourceBytes",
        "DedupVersion",
        "MetricName",
        "OrganizationId",
        "PointId",
        "SeriesId",
        "TenantId",
      ].sort(),
    );
    expect(shadow).not.toHaveProperty("WrittenAt");
  });

  describe("when a replay chunk is written", () => {
    it("sends one insert per table rather than one per point", async () => {
      const insert = vi.fn<
        (args: { table: string; values: unknown[] }) => Promise<void>
      >(async () => {});
      const client = { insert } as never;
      const repository = new MetricDataPointClickHouseRepository({
        resolveClient: async () => client,
        resolveOrganizationClient: async () => client,
      });
      const points = [
        { ...dataPoint(), pointId: "a".repeat(64), timeUnixMs: 1 },
        { ...dataPoint(), pointId: "b".repeat(64), timeUnixMs: 2 },
        { ...dataPoint(), pointId: "c".repeat(64), timeUnixMs: 3 },
      ];

      await repository.ensureDataPoints({ points, retentionDays: 49 });

      expect(insert).toHaveBeenCalledTimes(2);
      expect(insert.mock.calls.map((call) => call[0].table)).toEqual([
        "metric_data_points",
        "metric_usage_estimates",
      ]);
      expect(insert.mock.calls[0]![0].values).toHaveLength(3);
      expect(insert.mock.calls[1]![0].values).toHaveLength(3);
    });

    it("collapses a series to its newest point, which is the only one that can win", async () => {
      const insert = vi.fn<
        (args: { table: string; values: unknown[] }) => Promise<void>
      >(async () => {});
      const client = { insert } as never;
      const repository = new MetricDataPointClickHouseRepository({
        resolveClient: async () => client,
        resolveOrganizationClient: async () => client,
      });
      const base = dataPoint();
      const points = [
        { ...base, pointId: "a".repeat(64), timeUnixMs: 1_000 },
        { ...base, pointId: "b".repeat(64), timeUnixMs: 3_000 },
        { ...base, pointId: "c".repeat(64), timeUnixMs: 2_000 },
      ];

      await repository.upsertSeriesMany({ points, retentionDays: 49 });

      expect(insert).toHaveBeenCalledOnce();
      const values = insert.mock.calls[0]![0].values as Array<
        Record<string, unknown>
      >;
      expect(values).toHaveLength(1);
      expect(values[0]).toMatchObject({ LastSeenAt: new Date(3_000) });
    });
  });

  it("uses PointId-deduplicated analysis and organization-aware routing", async () => {
    const query = vi.fn<
      (args: { query: string }) => Promise<{ json: () => Promise<unknown[]> }>
    >(async () => ({
      json: async () => [
        {
          OrganizationId: "organization-1",
          UniqueActiveSeries: "2",
          ActiveSeriesHours: "3",
          AcceptedPoints: "5",
          CanonicalRetainedBytes: "123",
          ProjectedEventEquivalentUsage: "3",
        },
      ],
    }));
    const projectResolver = vi.fn(async () => ({ query }) as never);
    const organizationResolver = vi.fn(async () => ({ query }) as never);
    const repository = new MetricDataPointClickHouseRepository({
      resolveClient: projectResolver,
      resolveOrganizationClient: organizationResolver,
    });

    const result = await repository.queryUsageEstimates({
      organizationId: "organization-1",
      from: new Date("2026-01-01T00:00:00Z"),
      to: new Date("2026-02-01T00:00:00Z"),
      groupBy: "organization",
    });

    expect(projectResolver).not.toHaveBeenCalled();
    expect(organizationResolver).toHaveBeenCalledWith("organization-1");
    expect(query.mock.calls[0]![0].query).toContain("GROUP BY PointId");
    expect(query.mock.calls[0]![0].query).toContain(
      "HAVING min(AcceptedAt) >= {from:DateTime64(3)}",
    );
    expect(query.mock.calls[0]![0].query).toContain(
      "uniqExact(tuple(SeriesId, AcceptedHour))",
    );
    // Pins the isolation carve-out in clickhouse-queries.md: the shadow ledger
    // is organization-scoped, so OrganizationId leads the predicate and no
    // TenantId filter is applied when no tenant was asked for.
    expect(query.mock.calls[0]![0].query).toContain(
      "WHERE OrganizationId = {organizationId:String}",
    );
    expect(query.mock.calls[0]![0].query).not.toContain(
      "TenantId = {tenantId:String}",
    );
    expect(result).toEqual([
      {
        organizationId: "organization-1",
        tenantId: null,
        metricName: null,
        acceptedHour: null,
        uniqueActiveSeries: 2,
        activeSeriesHours: 3,
        acceptedPoints: 5,
        canonicalRetainedBytes: 123,
        projectedEventEquivalentUsage: 3,
      },
    ]);
  });

  describe("when a coalesced chunk is folded into rollups", () => {
    // A bucket-aligned base keeps every generated point inside one 30s bucket,
    // so the affected-bucket read stays at a single seek and the successor
    // seeks are the only thing the chunk size moves.
    const base =
      Math.floor(1_700_000_000_000 / METRIC_ROLLUP_INTERVAL_MS) *
      METRIC_ROLLUP_INTERVAL_MS;

    function chunkOf(count: number): CanonicalMetricDataPoint[] {
      return Array.from({ length: count }, (_, index) => {
        const timeUnixMs = base + index;
        return {
          ...dataPoint(),
          pointId: String(index).padStart(64, "0"),
          timeUnixMs,
          timeUnixNano: String(BigInt(timeUnixMs) * 1_000_000n),
        };
      });
    }

    function reader() {
      const query = vi.fn<
        (args: { query: string }) => Promise<{ json: () => Promise<unknown[]> }>
      >(async () => ({ json: async () => [] }));
      const insert = vi.fn(async () => {});
      return { query, client: { query, insert } as never };
    }

    it("reads once for the successors and once for the affected bucket", async () => {
      const { query, client } = reader();
      const repository = new MetricDataPointClickHouseRepository({
        resolveClient: async () => client,
        resolveOrganizationClient: async () => client,
      });

      await repository.recomputeAffectedRollupsMany({ points: chunkOf(12) });

      expect(query).toHaveBeenCalledTimes(2);
    });

    it("keeps the reads flat as the chunk grows within the seek budget", async () => {
      const { query, client } = reader();
      const repository = new MetricDataPointClickHouseRepository({
        resolveClient: async () => client,
        resolveOrganizationClient: async () => client,
      });

      await repository.recomputeAffectedRollupsMany({ points: chunkOf(64) });

      expect(query).toHaveBeenCalledTimes(2);
    });

    it("reads one series' successors in a single request however long the chunk", async () => {
      const { query, client } = reader();
      const repository = new MetricDataPointClickHouseRepository({
        resolveClient: async () => client,
        resolveOrganizationClient: async () => client,
      });

      // 130 points used to need three statements of successor seeks because
      // the statement grew a branch per point. It is now one request per
      // batch of series, and these 130 points are all one series.
      await repository.recomputeAffectedRollupsMany({ points: chunkOf(130) });

      expect(query).toHaveBeenCalledTimes(2);
    });

    it("asks for each point's own successor rather than its predecessor", async () => {
      const { query, client } = reader();
      const repository = new MetricDataPointClickHouseRepository({
        resolveClient: async () => client,
        resolveOrganizationClient: async () => client,
      });

      await repository.recomputeAffectedRollupsMany({ points: chunkOf(2) });

      const successorSeeks = query.mock.calls[0]![0].query;
      // The bound is what encodes "successor" — an ascending order with a `<`
      // bound would still read backwards, so pin the direction of both. The
      // open-ended look forward is the branch bounded by the span's far end.
      expect(successorSeeks).toContain(
        "series_points.SeekTime > spans.SpanToTime",
      );
      expect(successorSeeks).toContain(
        "ORDER BY series_points.SeriesId ASC, series_points.SeekTime ASC",
      );
      expect(successorSeeks).toContain("LIMIT 1 BY SeriesId");
    });

    it("never fetches the payload column on either read", async () => {
      const { query, client } = reader();
      const repository = new MetricDataPointClickHouseRepository({
        resolveClient: async () => client,
        resolveOrganizationClient: async () => client,
      });

      await repository.recomputeAffectedRollupsMany({ points: chunkOf(2) });

      // The fold never reads CanonicalPayload, and it is the one
      // megabyte-scale column: fetching it through FINAL across the folded
      // seek branches can push a single query past the server's per-query
      // memory cap (MEMORY_LIMIT_EXCEEDED in ReplacingSorted). Both reads
      // must stay payload-free.
      const successorSeeks = query.mock.calls[0]![0].query;
      const bucketReads = query.mock.calls[1]![0].query;
      expect(successorSeeks).not.toContain("CanonicalPayload");
      expect(bucketReads).not.toContain("CanonicalPayload");
      // The seek stays minimal: sequence fields only.
      expect(successorSeeks).not.toContain("ResourceAttributesJson");
      expect(bucketReads).toContain("BucketCounts");
    });

    it("folds rows that arrive without the payload column all the way to a rollup write", async () => {
      // Runtime counterpart to the SQL-text assertions above: the mock
      // REJECTS any read that asks for the payload column and answers with
      // rows that omit it, so this executes fromSeekRow and the
      // payload-free fromRaw end to end instead of only inspecting strings.
      const point = { ...dataPoint(), timeUnixMs: base + 1_000 };
      const seekRow = {
        SeriesId: point.seriesId,
        PointId: "f".repeat(64),
        TimeUnixMs: base + 2_000,
        TimeUnixNano: String(BigInt(base + 2_000) * 1_000_000n),
        MetricKind: "gauge",
        AggregationTemporality: "unspecified",
      };
      const authoritativeRow = {
        TenantId: point.tenantId,
        PointId: point.pointId,
        SeriesId: point.seriesId,
        ResourceSchemaUrl: "",
        ResourceAttributesJson: "[]",
        ResourceAttributeKeys: [],
        ScopeSchemaUrl: "",
        ScopeName: "scope",
        ScopeVersion: "",
        ScopeAttributesJson: "[]",
        ScopeAttributeKeys: [],
        MetricName: "requests",
        MetricDescription: "",
        MetricUnit: "1",
        MetricKind: "gauge",
        AggregationTemporality: "unspecified",
        IsMonotonic: null,
        PointAttributesJson: "[]",
        PointAttributeKeys: [],
        StartTimeUnixNano: "0",
        TimeUnixNano: point.timeUnixNano,
        TimeUnixMs: point.timeUnixMs,
        Flags: 0,
        ValueType: "double",
        ValueInt: null,
        ValueDouble: 1.5,
        Count: null,
        Sum: null,
        Min: null,
        Max: null,
        ExplicitBounds: [],
        BucketCounts: [],
        ExponentialScale: null,
        ExponentialZeroThreshold: null,
        ZeroCount: null,
        PositiveOffset: null,
        PositiveBucketCounts: [],
        NegativeOffset: null,
        NegativeBucketCounts: [],
        SummaryQuantilesJson: "[]",
        _size_bytes: 23,
        OccurredAt: point.timeUnixMs,
        AcceptedAt: point.timeUnixMs,
      };
      const query = vi.fn<
        (args: { query: string }) => Promise<{ json: () => Promise<unknown[]> }>
      >(async ({ query: sql }) => {
        if (sql.includes("CanonicalPayload")) {
          throw new Error("read selected the payload column");
        }
        return sql.includes("{from0:")
          ? { json: async () => [authoritativeRow] }
          : { json: async () => [seekRow] };
      });
      const insert = vi.fn<
        (args: { table: string; values: unknown[] }) => Promise<void>
      >(async () => {});
      const repository = new MetricDataPointClickHouseRepository({
        resolveClient: async () => ({ query, insert }) as never,
        resolveOrganizationClient: async () => ({ query, insert }) as never,
      });

      await repository.recomputeAffectedRollupsMany({ points: [point] });

      const rollupInsert = insert.mock.calls.find(
        (call) => call[0].table === "metric_time_rollups",
      );
      expect(rollupInsert).toBeDefined();
      expect(rollupInsert![0].values.length).toBeGreaterThan(0);
    });
  });

  /**
   * The rollup lane once emitted four `param_*` entries and a whole SELECT
   * branch per point. A chunk therefore built a request that grew with the
   * chunk — tens of kilobytes of SQL and hundreds of parameters — and
   * production saw ClickHouse parse one such request's URL-encoded search
   * string as SQL and reject it with a syntax error at the first `&`. That
   * stopped when a later change happened to make the request smaller, not
   * because anything bounded it. These are the tests that bound it: the
   * request a chunk produces must not move at all as the chunk grows.
   */
  describe("when the successor read is built for a chunk", () => {
    const base =
      Math.floor(1_700_000_000_000 / METRIC_ROLLUP_INTERVAL_MS) *
      METRIC_ROLLUP_INTERVAL_MS;

    function hex(value: number): string {
      return value.toString(16).padStart(64, "0");
    }

    function pointAt({
      series,
      offsetMs,
    }: {
      series: number;
      offsetMs: number;
    }): CanonicalMetricDataPoint {
      const timeUnixMs = base + offsetMs;
      return {
        ...dataPoint(),
        seriesId: hex(series),
        pointId: hex(series * 1_000_000 + offsetMs),
        timeUnixMs,
        timeUnixNano: String(BigInt(timeUnixMs) * 1_000_000n),
      };
    }

    /** One point per series, so the arrays grow while the chunk stays flat. */
    function acrossSeries(count: number): CanonicalMetricDataPoint[] {
      return Array.from({ length: count }, (_, index) =>
        pointAt({ series: index + 1, offsetMs: index }),
      );
    }

    /** Many points in one series, so the chunk grows while the arrays stay flat. */
    function withinOneSeries(count: number): CanonicalMetricDataPoint[] {
      return Array.from({ length: count }, (_, index) =>
        pointAt({ series: 1, offsetMs: index }),
      );
    }

    async function successorRequests(points: CanonicalMetricDataPoint[]) {
      const calls: { query: string; params: Record<string, unknown> }[] = [];
      const query = vi.fn(
        async ({
          query: sql,
          query_params: params,
        }: {
          query: string;
          query_params: Record<string, unknown>;
        }) => {
          if (sql.includes("spans")) calls.push({ query: sql, params });
          return { json: async () => [] };
        },
      );
      const client = { query, insert: vi.fn(async () => {}) } as never;
      const repository = new MetricDataPointClickHouseRepository({
        resolveClient: async () => client,
        resolveOrganizationClient: async () => client,
      });
      await repository.recomputeAffectedRollupsMany({ points });
      return calls;
    }

    /** @scenario "A folded rollup read sends a fixed-size request" */
    it("sends byte-for-byte the same statement as the chunk grows", async () => {
      const statements = await Promise.all(
        [1, 12, 64, 130, 260].map(async (count) => {
          const [request] = await successorRequests(withinOneSeries(count));
          return request!.query;
        }),
      );

      // Not "smaller than before" — identical. A statement that still grows,
      // however slowly, only moves the size at which this breaks again.
      expect(new Set(statements).size).toBe(1);
      expect(new Set(statements.map((sql) => sql.length)).size).toBe(1);
    });

    /** @scenario "A folded rollup read sends a fixed-size request" */
    it("sends the same statement however many series the chunk touches", async () => {
      const statements = await Promise.all(
        [1, 8, 64].map(async (count) => {
          const [request] = await successorRequests(acrossSeries(count));
          return request!.query;
        }),
      );

      expect(new Set(statements).size).toBe(1);
    });

    /** @scenario "A folded rollup read binds a fixed number of parameters" */
    it("binds the same parameters as the chunk grows", async () => {
      const parameterNames = await Promise.all(
        [1, 12, 64, 130, 260].map(async (count) => {
          const [request] = await successorRequests(withinOneSeries(count));
          return Object.keys(request!.params).sort().join(",");
        }),
      );

      expect(new Set(parameterNames).size).toBe(1);
      // Every per-point value rides inside an array, so the count is the
      // whole contract: nine, whatever the chunk holds.
      expect(parameterNames[0]!.split(",")).toEqual(
        [
          "fromNanos",
          "fromPoints",
          "fromTimes",
          "scanFrom",
          "seriesIds",
          "tenantId",
          "toNanos",
          "toPoints",
          "toTimes",
        ].sort(),
      );
    });

    /** @scenario "A folded rollup read binds a fixed number of parameters" */
    it("binds the same parameters however many series the chunk touches", async () => {
      const parameterNames = await Promise.all(
        [1, 8, 64].map(async (count) => {
          const [request] = await successorRequests(acrossSeries(count));
          return Object.keys(request!.params).sort().join(",");
        }),
      );

      expect(new Set(parameterNames).size).toBe(1);
    });

    /** @scenario "A folded rollup read names its columns once" */
    it("names the sequence columns once rather than once per branch", async () => {
      const [request] = await successorRequests(withinOneSeries(64));

      const columnList = request!.query.split(
        "toUnixTimestamp64Milli(TimeUnixMs) AS TimeUnixMs",
      ).length;
      expect(columnList - 1).toBe(1);
      // The payload column is what pushed this read past the per-query memory
      // cap in #6493; hoisting the select list must not quietly restore it.
      expect(request!.query).not.toContain("CanonicalPayload");
      expect(request!.query).not.toContain("ResourceAttributesJson");
    });

    /** @scenario "A folded rollup read binds a fixed number of parameters" */
    it("splits the request once the series outgrow the seek budget", async () => {
      expect(await successorRequests(acrossSeries(64))).toHaveLength(1);
      expect(await successorRequests(acrossSeries(65))).toHaveLength(2);
    });
  });

  /**
   * Result equivalence for the folded read. The statement no longer seeks once
   * per point: it reads the chunk's own span in one branch and looks past the
   * end of it in another. Those rows differ from the per-point seek's rows, so
   * what has to be proven is that the rollup lane resolves the same successors
   * from them — observable as the buckets it then goes on to read.
   */
  describe("when the folded read replaces a seek per point", () => {
    const base =
      Math.floor(1_700_000_000_000 / METRIC_ROLLUP_INTERVAL_MS) *
      METRIC_ROLLUP_INTERVAL_MS;

    interface StoredRow {
      seriesId: string;
      pointId: string;
      timeUnixMs: number;
      timeUnixNano: string;
    }

    function hex(value: number): string {
      return value.toString(16).padStart(64, "0");
    }

    function stored({
      series,
      offsetMs,
    }: {
      series: number;
      offsetMs: number;
    }): StoredRow {
      const timeUnixMs = base + offsetMs;
      return {
        seriesId: hex(series),
        pointId: hex(series * 1_000_000 + offsetMs),
        timeUnixMs,
        timeUnixNano: String(BigInt(timeUnixMs) * 1_000_000n),
      };
    }

    function chunkPoint(row: StoredRow): CanonicalMetricDataPoint {
      return { ...dataPoint(), ...row };
    }

    function compare<T>(left: T, right: T): number {
      if (left === right) return 0;
      return left < right ? -1 : 1;
    }

    /** The table's ORDER BY, which collates PointId by bytes. */
    function order(left: StoredRow, right: StoredRow): number {
      return (
        compare(BigInt(left.timeUnixNano), BigInt(right.timeUnixNano)) ||
        compare(left.pointId, right.pointId)
      );
    }

    /** What the folded statement returns, read off its array parameters. */
    function foldedRows({
      params,
      table,
    }: {
      params: Record<string, unknown>;
      table: readonly StoredRow[];
    }): StoredRow[] {
      const seriesIds = params.seriesIds as string[];
      const bound = (prefix: "from" | "to", index: number, seriesId: string) =>
        ({
          seriesId,
          pointId: (params[`${prefix}Points`] as string[])[index]!,
          timeUnixMs: (params[`${prefix}Times`] as number[])[index]!,
          timeUnixNano: (params[`${prefix}Nanos`] as string[])[index]!,
        }) satisfies StoredRow;

      return seriesIds.flatMap((seriesId, index) => {
        const from = bound("from", index, seriesId);
        const to = bound("to", index, seriesId);
        const inSeries = table
          .filter(
            (row) =>
              row.seriesId === seriesId &&
              row.timeUnixMs >= (params.scanFrom as number),
          )
          .sort(order);
        const withinSpan = inSeries.filter(
          (row) => order(row, from) > 0 && order(row, to) < 0,
        );
        const pastSpan = inSeries.find((row) => order(row, to) > 0);
        return pastSpan ? [...withinSpan, pastSpan] : withinSpan;
      });
    }

    /** What the seek-per-point statement it replaced returned. */
    function perPointRows({
      points,
      table,
    }: {
      points: readonly CanonicalMetricDataPoint[];
      table: readonly StoredRow[];
    }): StoredRow[] {
      return points.flatMap((point) => {
        const successor = table
          .filter((row) => row.seriesId === point.seriesId)
          .sort(order)
          .find((row) => order(row, point) > 0);
        return successor ? [successor] : [];
      });
    }

    /**
     * The buckets the lane goes on to read, which is where a wrong successor
     * would surface: `(series, bucket start)` pairs, sorted so the comparison
     * does not depend on the order the seeks were emitted in.
     */
    async function bucketsReadFor({
      points,
      successors,
    }: {
      points: CanonicalMetricDataPoint[];
      successors: (params: Record<string, unknown>) => StoredRow[];
    }): Promise<string[]> {
      const buckets: string[] = [];
      const seekRows = (params: Record<string, unknown>) =>
        successors(params).map((row) => ({
          SeriesId: row.seriesId,
          PointId: row.pointId,
          TimeUnixMs: row.timeUnixMs,
          TimeUnixNano: row.timeUnixNano,
          MetricKind: "gauge",
          AggregationTemporality: "unspecified",
        }));
      const recordBuckets = (params: Record<string, unknown>) => {
        for (const [name, value] of Object.entries(params)) {
          const seek = /^from(\d+)$/.exec(name);
          if (!seek) continue;
          buckets.push(
            `${String(params[`series${seek[1]!}`])}@${String(value)}`,
          );
        }
      };
      const query = vi.fn(
        async ({
          query: sql,
          query_params: params,
        }: {
          query: string;
          query_params: Record<string, unknown>;
        }) => {
          if (sql.includes("spans")) {
            return { json: async () => seekRows(params) };
          }
          recordBuckets(params);
          return { json: async () => [] };
        },
      );
      const client = { query, insert: vi.fn(async () => {}) } as never;
      const repository = new MetricDataPointClickHouseRepository({
        resolveClient: async () => client,
        resolveOrganizationClient: async () => client,
      });
      await repository.recomputeAffectedRollupsMany({ points });
      return buckets.sort();
    }

    /** Both shapes' recomputed windows, for the caller to compare. */
    async function bothShapes({
      points,
      table,
    }: {
      points: CanonicalMetricDataPoint[];
      table: StoredRow[];
    }): Promise<{ folded: string[]; perPoint: string[] }> {
      return {
        folded: await bucketsReadFor({
          points,
          successors: (params) => foldedRows({ params, table }),
        }),
        perPoint: await bucketsReadFor({
          points,
          successors: () => perPointRows({ points, table }),
        }),
      };
    }

    /** @scenario "A folded rollup read resolves the successors a per-point read did" */
    it("resolves the same successor for a single seek", async () => {
      const point = stored({ series: 1, offsetMs: 0 });
      const table = [
        point,
        stored({ series: 1, offsetMs: METRIC_ROLLUP_INTERVAL_MS * 3 }),
      ];

      const { folded, perPoint } = await bothShapes({
        points: [chunkPoint(point)],
        table,
      });

      expect(folded).toEqual(perPoint);
      expect(folded.length).toBeGreaterThan(0);
    });

    /** @scenario "A folded rollup read resolves the successors a per-point read did" */
    it("resolves the same successors for a chunk that fills the seek budget", async () => {
      // 64 points in one series with points stored between them, so the span
      // branch is what has to supply the interior successors.
      const chunk = Array.from({ length: 64 }, (_, index) =>
        stored({ series: 1, offsetMs: index * 1_000 }),
      );
      const interleaved = Array.from({ length: 63 }, (_, index) =>
        stored({ series: 1, offsetMs: index * 1_000 + 500 }),
      );
      const table = [
        ...chunk,
        ...interleaved,
        stored({ series: 1, offsetMs: 200_000 }),
      ];

      const { folded, perPoint } = await bothShapes({
        points: chunk.map(chunkPoint),
        table,
      });

      expect(folded).toEqual(perPoint);
      expect(folded.length).toBeGreaterThan(0);
    });

    /** @scenario "A folded rollup read resolves the successors a per-point read did" */
    it("resolves the same successors across a chunk boundary", async () => {
      // 65 series is one more than a single request carries, so the lane
      // splits — the successors must not depend on where the split fell.
      const chunk = Array.from({ length: 65 }, (_, index) =>
        stored({ series: index + 1, offsetMs: index }),
      );
      const table = [
        ...chunk,
        ...chunk.map((row, index) =>
          stored({
            series: index + 1,
            offsetMs: index + METRIC_ROLLUP_INTERVAL_MS * 2,
          }),
        ),
      ];

      const { folded, perPoint } = await bothShapes({
        points: chunk.map(chunkPoint),
        table,
      });

      expect(folded).toEqual(perPoint);
      expect(folded.length).toBeGreaterThan(0);
    });

    /** @scenario "A folded rollup read resolves the successors a per-point read did" */
    it("resolves no successor for the newest point in a series", async () => {
      const first = stored({ series: 1, offsetMs: 0 });
      const last = stored({ series: 1, offsetMs: 500 });

      const { folded, perPoint } = await bothShapes({
        points: [first, last].map(chunkPoint),
        table: [first, last],
      });

      expect(folded).toEqual(perPoint);
      expect(folded.length).toBeGreaterThan(0);
    });
  });

  /**
   * The bucket reads keep a seek per affected bucket on purpose: the
   * predecessor branch is bounded below by the retention window, and a joined
   * form can only apply that bound after the rows are read, turning a
   * single-row reverse index seek into a read of the series across the whole
   * window. What they can shed is the parameter fan-out for values the server
   * can derive itself.
   */
  describe("when the affected buckets are read", () => {
    const base =
      Math.floor(1_700_000_000_000 / METRIC_ROLLUP_INTERVAL_MS) *
      METRIC_ROLLUP_INTERVAL_MS;

    /** @scenario "A rollup bucket read derives its bounds on the server" */
    it("binds two parameters per bucket rather than four", async () => {
      let bucketRead: Record<string, unknown> | undefined;
      const query = vi.fn(
        async ({
          query: sql,
          query_params: params,
        }: {
          query: string;
          query_params: Record<string, unknown>;
        }) => {
          if (!sql.includes("spans")) bucketRead = params;
          return { json: async () => [] };
        },
      );
      const client = { query, insert: vi.fn(async () => {}) } as never;
      const repository = new MetricDataPointClickHouseRepository({
        resolveClient: async () => client,
        resolveOrganizationClient: async () => client,
      });

      await repository.recomputeAffectedRollupsMany({
        points: [{ ...dataPoint(), timeUnixMs: base + 1 }],
        retentionDays: 49,
      });

      const names = Object.keys(bucketRead!).sort();
      expect(names).toEqual(
        ["tenantId", "bucketMs", "retentionMs", "series0", "from0"].sort(),
      );
      // The bucket end and the retention floor are the same arithmetic on
      // either side of the wire, so they travel once as shared scalars.
      expect(bucketRead!.bucketMs).toBe(METRIC_ROLLUP_INTERVAL_MS);
      expect(bucketRead!.retentionMs).toBe(49 * 24 * 60 * 60 * 1000);
      expect(names).not.toContain("to0");
      expect(names).not.toContain("cutoff0");
    });
  });

  describe("when a folded read answers with a row it cannot decode", () => {
    const base =
      Math.floor(1_700_000_000_000 / METRIC_ROLLUP_INTERVAL_MS) *
      METRIC_ROLLUP_INTERVAL_MS;

    /**
     * The shape the rollup lane actually failed on: a row that parses as JSON
     * and carries its identifiers, but is missing one of the `Array(UInt64)`
     * count columns the decoder dereferences unguarded. Walking straight into
     * `undefined.map` costs the whole diagnosis — the queue logs an error's
     * message and nothing else, so the failure names no column, no series and
     * no query.
     */
    function rowMissingBucketCounts() {
      const point = dataPoint();
      return {
        TenantId: point.tenantId,
        PointId: point.pointId,
        SeriesId: point.seriesId,
        TimeUnixMs: base,
        TimeUnixNano: String(BigInt(base) * 1_000_000n),
        StartTimeUnixNano: "1",
        MetricKind: "gauge",
        AggregationTemporality: "unspecified",
        PositiveBucketCounts: [],
        NegativeBucketCounts: [],
      };
    }

    it("names the missing column, the series and the point instead of dereferencing it", async () => {
      const query = vi.fn(async () => ({
        json: async () => [rowMissingBucketCounts()],
      }));
      const client = { query, insert: vi.fn(async () => {}) } as never;
      const repository = new MetricDataPointClickHouseRepository({
        resolveClient: async () => client,
        resolveOrganizationClient: async () => client,
      });

      const point = dataPoint();
      // One rejection, three identifiers: the column that was absent, and the
      // series + point that locate the untrustworthy row. That is the whole
      // contract this guard exists for — a bare undefined-property error named
      // none of them.
      await expect(
        repository.recomputeAffectedRollupsMany({
          points: [{ ...point, timeUnixMs: base }],
        }),
      ).rejects.toThrow(
        new RegExp(
          `missing the BucketCounts column \\(series ${point.seriesId}, point ${point.pointId}\\)`,
        ),
      );
    });
  });
});

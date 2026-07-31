import { describe, expect, it, vi } from "vitest";
import { LogRecordStorageClickHouseRepository } from "../log-record-storage.clickhouse.repository";

// Legacy attribute key the ingest path used to stamp on claude_code content
// logs. The marking is gone; this key is asserted here only to pin that the
// read path never filters on it.
const LEGACY_CLAUDE_KIND_ATTR = "langwatch.claude_code.kind";

const repoCapturingQuery = (rows: unknown[] = []) => {
  // The client returns decoded, column-named rows directly — the repository
  // mutates that array to trim the over-fetched detection row, so each call
  // hands back its own copy.
  const query = vi.fn(async () => [...rows]);
  const resolveClient = (async () => ({
    query,
  })) as unknown as ConstructorParameters<
    typeof LogRecordStorageClickHouseRepository
  >[0];
  const repo = new LogRecordStorageClickHouseRepository(resolveClient);
  return { repo, query };
};

const capturedQuery = (query: ReturnType<typeof vi.fn>) =>
  query.mock.calls[0]![0] as {
    sql: string;
    params: Record<string, unknown>;
  };

describe("LogRecordStorageClickHouseRepository.getLogsByTraceId", () => {
  // stored_log_records is PARTITION BY toYearWeek(TimeUnixMs); the read must
  // carry a TimeUnixMs predicate to prune partitions instead of cold-scanning
  // every weekly partition (incl. cold S3).
  describe("when the caller provides the trace's approximate time", () => {
    it("bounds the scan to a ±2d TimeUnixMs window in both the outer and dedup scopes", async () => {
      const { repo, query } = repoCapturingQuery();
      const occurredAtMs = 1_700_000_000_000;

      await repo.getLogsByTraceId("project_test", "trace-1", occurredAtMs);

      const { sql, params } = capturedQuery(query);
      expect(sql.match(/TimeUnixMs >= fromUnixTimestamp64Milli/g)).toHaveLength(
        2,
      );
      const windowMs = 2 * 24 * 60 * 60 * 1000;
      expect(params.fromMs).toBe(occurredAtMs - windowMs);
      expect(params.toMs).toBe(occurredAtMs + windowMs);
    });
  });

  // The read is single-shot: a hinted window that comes back empty is
  // authoritative (`fallback: "none"` in the queryWindowed adopter), so it must
  // NOT fire a second, wider query the way an `"unbounded"`/`{ lookbackMs }`
  // fallback would. This pins the pre-adopter behaviour through the migration.
  describe("when the caller provides a time and the hinted window is empty", () => {
    it("does not re-widen — it issues exactly one query", async () => {
      const { repo, query } = repoCapturingQuery([]);

      await repo.getLogsByTraceId("project_test", "trace-1", 1_700_000_000_000);

      expect(query).toHaveBeenCalledTimes(1);
      const { params } = capturedQuery(query);
      const windowMs = 2 * 24 * 60 * 60 * 1000;
      // The single query stayed on the ±2d hinted window; it never fell back to
      // the now-anchored lookback frame.
      expect(params.fromMs).toBe(1_700_000_000_000 - windowMs);
      expect(params.toMs).toBe(1_700_000_000_000 + windowMs);
    });
  });

  describe("when the caller does not provide a time", () => {
    it("falls back to a 90d-lookback window with clock-skew headroom on the upper bound", async () => {
      const { repo, query } = repoCapturingQuery();
      const before = Date.now();

      await repo.getLogsByTraceId("project_test", "trace-1");

      const after = Date.now();
      const { sql, params } = capturedQuery(query);
      expect(sql.match(/TimeUnixMs >= fromUnixTimestamp64Milli/g)).toHaveLength(
        2,
      );
      const partitionWindowMs = 2 * 24 * 60 * 60 * 1000;
      const lookbackMs = 90 * 24 * 60 * 60 * 1000;
      const toMs = params.toMs as number;
      const fromMs = params.fromMs as number;
      // Upper bound is now() + 2d (clock-skew headroom).
      expect(toMs).toBeGreaterThanOrEqual(before + partitionWindowMs);
      expect(toMs).toBeLessThanOrEqual(after + partitionWindowMs);
      // The gap between fromMs and toMs is the 90d lookback + the headroom.
      expect(toMs - fromMs).toBe(lookbackMs + partitionWindowMs);
    });
  });

  // The heavy Body column rides every row, so the read must be bounded: an
  // uncapped marathon-session trace (thousands of logs × up to 60 KB bodies)
  // re-opens the fat-payload memory failure mode on the READ side.
  describe("when a trace has more logs than the read cap", () => {
    const storedRow = (index: number) => ({
      TraceId: "trace-1",
      SpanId: `span-${index}`,
      TimeUnixMs: 1_700_000_000_000 + index,
      Body: "api_request_body",
      Attributes: {},
      ResourceAttributes: {},
      ScopeName: "s",
      ScopeVersion: null,
    });

    it("bounds the query at the default cap plus one detection row", async () => {
      const { repo, query } = repoCapturingQuery();

      await repo.getLogsByTraceId("project_test", "trace-1", 1_700_000_000_000);

      const { sql, params } = capturedQuery(query);
      expect(sql).toContain("LIMIT {limitPlusOne:UInt32}");
      expect(params.limitPlusOne).toBe(2001);
    });

    it("returns only the oldest rows up to a caller-narrowed limit", async () => {
      const { repo } = repoCapturingQuery([
        storedRow(0),
        storedRow(1),
        storedRow(2),
      ]);

      const rows = await repo.getLogsByTraceId(
        "project_test",
        "trace-1",
        1_700_000_000_000,
        2,
      );

      expect(rows.map((row) => row.spanId)).toEqual(["span-0", "span-1"]);
    });
  });

  describe("when reading the trace's logs (generic — no claude-kind filter)", () => {
    it("selects the Body + Attributes and does not filter on the claude kind attr", async () => {
      const { repo, query } = repoCapturingQuery();

      await repo.getLogsByTraceId("project_test", "trace-1", 1_700_000_000_000);

      const { sql, params } = capturedQuery(query);
      expect(sql).toContain("Body");
      expect(sql).toContain("Attributes");
      // The generic read must NOT re-introduce the retired claude-kind filter.
      expect(sql).not.toContain(LEGACY_CLAUDE_KIND_ATTR);
      expect(sql).not.toMatch(/Attributes\[\{kindKey/);
      expect(params.tenantId).toBe("project_test");
      expect(params.traceId).toBe("trace-1");
    });

    it("maps stored rows to StoredLogRecordRow with body + attributes + scope", async () => {
      const { repo } = repoCapturingQuery([
        {
          TraceId: "trace-1",
          SpanId: "span-1",
          TimeUnixMs: 1_700_000_000_000,
          Body: "api_request_body",
          Attributes: { "event.name": "api_request_body", body: '{"x":1}' },
          ResourceAttributes: { "langwatch.origin": "coding_agent" },
          ScopeName: "com.anthropic.claude_code.events",
          ScopeVersion: "1.2.3",
        },
      ]);

      const rows = await repo.getLogsByTraceId(
        "project_test",
        "trace-1",
        1_700_000_000_000,
      );

      expect(rows).toEqual([
        {
          traceId: "trace-1",
          spanId: "span-1",
          timeUnixMs: 1_700_000_000_000,
          body: "api_request_body",
          attributes: { "event.name": "api_request_body", body: '{"x":1}' },
          resourceAttributes: { "langwatch.origin": "coding_agent" },
          scopeName: "com.anthropic.claude_code.events",
          scopeVersion: "1.2.3",
        },
      ]);
    });
  });
});

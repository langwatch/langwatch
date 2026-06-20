import { describe, expect, it, vi } from "vitest";
import { EventExplorerClickHouseRepository } from "../event-explorer.clickhouse.repository";

const repoCapturingQuery = () => {
  const query = vi
    .fn()
    .mockResolvedValue({ json: async () => [] as unknown[] });
  const client = { query } as unknown as ConstructorParameters<
    typeof EventExplorerClickHouseRepository
  >[0];
  const repo = new EventExplorerClickHouseRepository(client);
  return { repo, query };
};

const capturedQuery = (query: ReturnType<typeof vi.fn>) =>
  query.mock.calls[0]![0] as {
    query: string;
    query_params: Record<string, unknown>;
  };

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

describe("EventExplorerClickHouseRepository.findAggregates", () => {
  describe("given a caller supplies a sinceMs", () => {
    /** @scenario "findAggregates filters on EventOccurredAt so partition pruning works" */
    it("filters on EventOccurredAt (the partition-key column), not on EventTimestamp", async () => {
      // The partition is `toYearWeek(toDateTime64(EventOccurredAt / 1000, 3))`.
      // Filtering on EventTimestamp (the version column) does *not* prune
      // partitions - the old code did exactly that and scanned every weekly
      // partition incl. cold S3.
      const { repo, query } = repoCapturingQuery();

      await repo.findAggregates({
        aggregateTypes: ["lw.suite_run"],
        sinceMs: 1_700_000_000_000,
      });

      const { query: sql, query_params } = capturedQuery(query);
      expect(sql).toContain("EventOccurredAt >= {sinceMs:UInt64}");
      expect(sql).not.toMatch(/EventTimestamp\s*>=/);
      expect(query_params.sinceMs).toBe(1_700_000_000_000);
    });
  });
});

describe("EventExplorerClickHouseRepository.searchAggregates", () => {
  describe("given neither tenantIds nor a non-empty query string is supplied", () => {
    /** @scenario "Unbounded event_log scan is refused at the app layer" */
    it("rejects the call rather than scanning the whole event_log table", async () => {
      const { repo } = repoCapturingQuery();
      await expect(
        repo.searchAggregates({ query: "", tenantIds: [] }),
      ).rejects.toThrow(/search query or pick at least one tenant/);
    });

    it("rejects when tenantIds is omitted entirely and query is whitespace", async () => {
      const { repo } = repoCapturingQuery();
      await expect(repo.searchAggregates({ query: "   " })).rejects.toThrow(
        /search query or pick at least one tenant/,
      );
    });
  });

  describe("given a non-empty query string is supplied", () => {
    /** @scenario "Search is bounded to the partition-prunable lookback window" */
    it("clamps the scan to the last 90 days via the EventOccurredAt predicate", async () => {
      const { repo, query } = repoCapturingQuery();
      const before = Date.now();

      await repo.searchAggregates({ query: "abc" });

      const after = Date.now();
      const { query: sql, query_params } = capturedQuery(query);
      expect(sql).toContain("EventOccurredAt >= {sinceMs:UInt64}");
      const sinceMs = query_params.sinceMs as number;
      expect(typeof sinceMs).toBe("number");
      // sinceMs is now() - 90 days at the moment the repo built the query
      expect(sinceMs).toBeGreaterThanOrEqual(before - NINETY_DAYS_MS);
      expect(sinceMs).toBeLessThanOrEqual(after - NINETY_DAYS_MS);
    });
  });
});

describe("EventExplorerClickHouseRepository.findEventsByAggregate", () => {
  describe("given the caller passes a sinceMs (routine ops listing)", () => {
    /** @scenario "findEventsByAggregate can be bounded by the caller" */
    it("includes the EventOccurredAt predicate in the SQL", async () => {
      const { repo, query } = repoCapturingQuery();

      await repo.findEventsByAggregate({
        aggregateId: "agg-1",
        tenantId: "project_test",
        limit: 10,
        sinceMs: 1_700_000_000_000,
      });

      const { query: sql, query_params } = capturedQuery(query);
      expect(sql).toContain("EventOccurredAt >= {sinceMs:UInt64}");
      expect(query_params.sinceMs).toBe(1_700_000_000_000);
    });
  });

  describe("given the caller omits sinceMs (projection replay)", () => {
    it("does not include the EventOccurredAt predicate so the full event history is reachable", async () => {
      const { repo, query } = repoCapturingQuery();

      await repo.findEventsByAggregate({
        aggregateId: "agg-1",
        tenantId: "project_test",
        limit: 10,
      });

      const { query: sql, query_params } = capturedQuery(query);
      expect(sql).not.toContain("EventOccurredAt >= {sinceMs:UInt64}");
      expect(query_params.sinceMs).toBeUndefined();
    });
  });
});

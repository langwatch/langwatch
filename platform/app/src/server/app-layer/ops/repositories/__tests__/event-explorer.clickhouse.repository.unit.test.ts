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

describe("EventExplorerClickHouseRepository.findAggregates", () => {
  describe("given a caller supplies a sinceMs", () => {
    describe("when findAggregates is called", () => {
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

      it("preserves the EventOccurredAt = 0 legacy-sentinel rows alongside the sinceMs cutoff", async () => {
        // Events that pre-date the EventOccurredAt column carry the sentinel
        // value 0. A naïve `>= sinceMs` filter would silently drop them from
        // the bulk-replay wizard. The OR-with-zero keeps partition pruning
        // (epoch-week partition + recent-N-weeks) while preserving the rows.
        const { repo, query } = repoCapturingQuery();

        await repo.findAggregates({
          aggregateTypes: ["lw.suite_run"],
          sinceMs: 1_700_000_000_000,
        });

        const { query: sql } = capturedQuery(query);
        expect(sql).toMatch(
          /EventOccurredAt\s*=\s*0\s+OR\s+EventOccurredAt\s*>=\s*\{sinceMs:UInt64\}/,
        );
      });
    });
  });
});

describe("EventExplorerClickHouseRepository.searchAggregates", () => {
  describe("given neither tenantIds nor a non-empty query string is supplied", () => {
    describe("when searchAggregates is called", () => {
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
  });

  describe("given the upfront guard is satisfied and the caller supplies sinceMs", () => {
    describe("when searchAggregates is called", () => {
      it("applies the EventOccurredAt time bound (preserving the EventOccurredAt = 0 legacy sentinel)", async () => {
        // The ops router defaults sinceMs to `now - 365 days` for the
        // DejaView UI, surfaced as a banner under the search box. The
        // repo just honours whatever the caller supplies - no silent
        // backend clamp. Zero-sentinel rows survive so historical test
        // data doesn't silently disappear.
        const { repo, query } = repoCapturingQuery();

        await repo.searchAggregates({
          query: "abc",
          tenantIds: ["project_x"],
          sinceMs: 1_700_000_000_000,
        });

        const { query: sql, query_params } = capturedQuery(query);
        expect(sql).toMatch(
          /EventOccurredAt\s*=\s*0\s+OR\s+EventOccurredAt\s*>=\s*\{sinceMs:UInt64\}/,
        );
        expect(query_params.sinceMs).toBe(1_700_000_000_000);
        expect(query_params.tenantIds).toEqual(["project_x"]);
      });
    });
  });

  describe("given the upfront guard is satisfied but no sinceMs is supplied", () => {
    describe("when searchAggregates is called", () => {
      it("stays unbounded on time so non-UI callers (integration tests, scripts) can scan full history knowingly", async () => {
        const { repo, query } = repoCapturingQuery();

        await repo.searchAggregates({ query: "abc" });

        const { query: sql, query_params } = capturedQuery(query);
        expect(sql).not.toContain("EventOccurredAt");
        expect(query_params.sinceMs).toBeUndefined();
      });
    });
  });
});

describe("EventExplorerClickHouseRepository.findEventsByAggregate", () => {
  describe("given an aggregate the operator has already selected", () => {
    describe("when findEventsByAggregate is called", () => {
      it("returns the full event history with no time bound (detail-view, full fold history needed for projection replay)", async () => {
        const { repo, query } = repoCapturingQuery();

        await repo.findEventsByAggregate({
          aggregateId: "agg-1",
          tenantId: "project_test",
          limit: 10,
        });

        const { query: sql, query_params } = capturedQuery(query);
        expect(sql).not.toContain("EventOccurredAt");
        expect(query_params).toEqual({
          tenantId: "project_test",
          aggregateId: "agg-1",
          limit: 10,
        });
      });
    });
  });
});

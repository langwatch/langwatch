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

  describe("given the upfront guard is satisfied (tenant or query string supplied)", () => {
    describe("when searchAggregates is called", () => {
      it("does not silently clamp the lookback to N days - the cold-tier bound is surfaced in the DejaView ops UI instead", async () => {
        // The repo used to clamp to "now - 90 days" via EventOccurredAt. That
        // turned out to be the wrong layer: it silently dropped aggregates
        // older than 90 days during incident archaeology where the operator
        // already knew the tenant. DejaView is an internal ops tool, so the
        // hot/cold-tier surface is handled in the UI (uses the env-var-derived
        // CLICKHOUSE_COLD_STORAGE_EVENT_LOG_TTL_DAYS value); the backend stays
        // unbounded on the time axis.
        const { repo, query } = repoCapturingQuery();

        await repo.searchAggregates({
          query: "abc",
          tenantIds: ["project_x"],
        });

        const { query: sql, query_params } = capturedQuery(query);
        expect(sql).not.toContain("EventOccurredAt");
        expect(query_params.sinceMs).toBeUndefined();
        expect(query_params.tenantIds).toEqual(["project_x"]);
      });

      it("stays unbounded on time when only a cross-tenant query string is supplied (guard still requires the query string itself)", async () => {
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
  describe("given the caller passes a sinceMs (routine ops listing)", () => {
    describe("when findEventsByAggregate is called", () => {
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
  });

  describe("given the caller omits sinceMs (projection replay)", () => {
    describe("when findEventsByAggregate is called", () => {
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
});

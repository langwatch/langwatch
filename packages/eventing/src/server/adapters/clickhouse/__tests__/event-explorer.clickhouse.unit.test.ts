/** Spec: packages/eventing/specs/event-table-surfaces.feature */
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { ValidationError } from "../../../../services/errorHandling.ts";
import type { EventingClickHouseReplayStatement } from "../../../clickhouse-client-resolver.ts";
import { EventingClickHouseEventExplorer } from "../event-explorer.clickhouse.ts";

/** The routed member, recording each statement the repository hands it. */
const repoCapturingQuery = () => {
  const statements: EventingClickHouseReplayStatement[] = [];
  const clickhouse = clickHouseQueryClientDouble({
    query: async (request: EventingClickHouseReplayStatement) => {
      statements.push(request);
      return { rows: [] };
    },
  });
  return { repo: EventingClickHouseEventExplorer.create({ clickhouse }), statements };
};

const capturedQuery = (statements: EventingClickHouseReplayStatement[]) => {
  const statement = statements[0];
  if (!statement) throw new Error("the repository issued no statement");
  return { query: statement.sql, query_params: statement.params ?? {}, statement };
};

describe("EventingClickHouseEventExplorer.findAggregates", () => {
  describe("given a caller supplies a sinceMs", () => {
    describe("when findAggregates is called", () => {
      it("filters on EventOccurredAt (the partition-key column), not on EventTimestamp", async () => {
        // The partition is `toYearWeek(toDateTime64(EventOccurredAt / 1000, 3))`.
        // Filtering on EventTimestamp (the version column) does *not* prune
        // partitions - the old code did exactly that and scanned every weekly
        // partition incl. cold S3.
        const { repo, statements } = repoCapturingQuery();

        await repo.findAggregates({
          aggregateTypes: ["lw.suite_run"],
          sinceMs: 1_700_000_000_000,
        });

        const { query: sql, query_params } = capturedQuery(statements);
        expect(sql).toContain("EventOccurredAt >= {sinceMs:UInt64}");
        expect(sql).not.toMatch(/EventTimestamp\s*>=/);
        expect(query_params.sinceMs).toBe(1_700_000_000_000);
      });

      it("preserves the EventOccurredAt = 0 legacy-sentinel rows alongside the sinceMs cutoff", async () => {
        // Events that pre-date the EventOccurredAt column carry the sentinel
        // value 0. A naïve `>= sinceMs` filter would silently drop them from
        // the bulk-replay wizard. The OR-with-zero keeps partition pruning
        // (epoch-week partition + recent-N-weeks) while preserving the rows.
        const { repo, statements } = repoCapturingQuery();

        await repo.findAggregates({
          aggregateTypes: ["lw.suite_run"],
          sinceMs: 1_700_000_000_000,
        });

        const { query: sql } = capturedQuery(statements);
        expect(sql).toMatch(
          /EventOccurredAt\s*=\s*0\s+OR\s+EventOccurredAt\s*>=\s*\{sinceMs:UInt64\}/,
        );
      });
    });
  });
});

describe("EventingClickHouseEventExplorer.searchAggregates", () => {
  describe("given neither tenantIds nor a non-empty query string is supplied", () => {
    describe("when searchAggregates is called", () => {
      /** @scenario "An event search bounded by neither a tenant nor a query is refused" */
      it("rejects the call rather than scanning the whole event_log table", async () => {
        const { repo, statements } = repoCapturingQuery();
        const refusal = await repo.searchAggregates({ query: "", tenantIds: [] }).catch((e) => e);
        expect(refusal).toBeInstanceOf(ValidationError);
        expect(statements).toEqual([]);
      });

      it("rejects when tenantIds is omitted entirely and query is whitespace", async () => {
        const { repo } = repoCapturingQuery();
        await expect(repo.searchAggregates({ query: "   " })).rejects.toThrow(
          /query string or at least one tenant/,
        );
      });
    });
  });

  describe("given the upfront guard is satisfied and the caller supplies sinceMs", () => {
    describe("when searchAggregates is called", () => {
      /** @scenario "An event search reads only rows inside its time bound" */
      it("applies the EventOccurredAt time bound (preserving the EventOccurredAt = 0 legacy sentinel)", async () => {
        // The ops router defaults sinceMs to `now - 365 days` for the
        // DejaView UI, surfaced as a banner under the search box. The
        // repo just honours whatever the caller supplies - no silent
        // backend clamp. Zero-sentinel rows survive so historical test
        // data doesn't silently disappear.
        const { repo, statements } = repoCapturingQuery();

        await repo.searchAggregates({
          query: "abc",
          tenantIds: ["project_x"],
          sinceMs: 1_700_000_000_000,
        });

        const { query: sql, query_params } = capturedQuery(statements);
        expect(sql).toMatch(
          /EventOccurredAt\s*=\s*0\s+OR\s+EventOccurredAt\s*>=\s*\{sinceMs:UInt64\}/,
        );
        expect(query_params.sinceMs).toBe(1_700_000_000_000);
        expect(query_params.tenantIds).toEqual(["project_x"]);
      });
    });
  });

  describe("given an operator searching across tenants", () => {
    describe("when searchAggregates is called", () => {
      /** @scenario "One aggregate's history reads its tenant's server, a cross-tenant search the shared one" */
      it("names no tenant and gives its reason, so the member reads the shared server", async () => {
        const { repo, statements } = repoCapturingQuery();

        await repo.searchAggregates({ query: "abc" });

        const { statement } = capturedQuery(statements);
        expect(statement.tenantId).toBe("");
        expect(statement.SKIP_TENANT_CHECK).toBe(true);
      });
    });
  });

  describe("given a process holding the install's shared endpoint", () => {
    describe("when an operator searches for an aggregate", () => {
      /** @scenario "The operator searches the event log through the composed explorer" */
      it("reads event_log and returns the matching aggregates", async () => {
        const statements: EventingClickHouseReplayStatement[] = [];
        const clickhouse = clickHouseQueryClientDouble({
          query: async (request: EventingClickHouseReplayStatement) => {
            statements.push(request);
            return {
              rows: [
                {
                  aggregateId: "trace-1",
                  aggregateType: "trace",
                  tenantId: "project-1",
                  eventCount: "3",
                  lastEventTime: "2026-10-06 10:00:00",
                },
              ],
            };
          },
        });
        const repo = EventingClickHouseEventExplorer.create({ clickhouse });

        const found = await repo.searchAggregates({ query: "trace-1" });

        expect(capturedQuery(statements).query).toContain("FROM event_log");
        expect(found).toEqual([
          {
            aggregateId: "trace-1",
            aggregateType: "trace",
            tenantId: "project-1",
            eventCount: 3,
            lastEventTime: "2026-10-06 10:00:00",
          },
        ]);
      });
    });
  });

  describe("given the upfront guard is satisfied but no sinceMs is supplied", () => {
    describe("when searchAggregates is called", () => {
      it("stays unbounded on time so non-UI callers (integration tests, scripts) can scan full history knowingly", async () => {
        const { repo, statements } = repoCapturingQuery();

        await repo.searchAggregates({ query: "abc" });

        const { query: sql, query_params } = capturedQuery(statements);
        expect(sql).not.toContain("EventOccurredAt");
        expect(query_params.sinceMs).toBeUndefined();
      });
    });
  });
});

describe("EventingClickHouseEventExplorer.findEventsByAggregate", () => {
  describe("given an aggregate the operator has already selected", () => {
    describe("when findEventsByAggregate is called", () => {
      it("returns the full event history with no time bound (detail-view, full fold history needed for projection replay)", async () => {
        const { repo, statements } = repoCapturingQuery();

        await repo.findEventsByAggregate({
          aggregateId: "agg-1",
          tenantId: "project_test",
          limit: 10,
        });

        const { query: sql, query_params } = capturedQuery(statements);
        expect(sql).not.toContain("EventOccurredAt");
        expect(query_params).toEqual({
          tenantId: "project_test",
          aggregateId: "agg-1",
          limit: 10,
        });
      });

      /** @scenario "One aggregate's history reads its tenant's server, a cross-tenant search the shared one" */
      it("names the aggregate's tenant, so the member reads that tenant's server", async () => {
        const { repo, statements } = repoCapturingQuery();

        await repo.findEventsByAggregate({
          aggregateId: "agg-1",
          tenantId: "project_test",
          limit: 10,
        });

        expect(capturedQuery(statements).statement.tenantId).toBe("project_test");
        expect(capturedQuery(statements).statement.SKIP_TENANT_CHECK).toBeUndefined();
      });
    });
  });
});

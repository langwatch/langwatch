/** Spec: packages/eventing/specs/event-table-surfaces.feature */
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { ValidationError } from "../../../../services/errorHandling.ts";
import { EventingClickHouseEventExplorer } from "../event-explorer.clickhouse.ts";

type SentRead = Parameters<ClickHouseQueryClient["read"]>[0];

/** The routed member, recording each built statement the repository hands it. */
const repoCapturingQuery = (rows: Record<string, unknown>[] = []) => {
  const statements: SentRead[] = [];
  const clickhouse = clickHouseQueryClientDouble({
    read: async (request: SentRead) => {
      statements.push(request);
      return { rows: JSON.parse(JSON.stringify(rows)) };
    },
  });
  return { repo: EventingClickHouseEventExplorer.create({ clickhouse }), statements };
};

const capturedQuery = (statements: SentRead[]) => {
  const sent = statements[0];
  if (!sent) throw new Error("the repository issued no statement");
  const { statement } = sent;
  return { query: statement.sql, values: Object.values(statement.params), statement };
};

const SENTINEL_OR_SINCE =
  /\(EventOccurredAt = \{v\d+:UInt64\} OR EventOccurredAt >= \{v\d+:UInt64\}\)/;

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

        const { query: sql, values } = capturedQuery(statements);
        expect(sql).toMatch(/EventOccurredAt >= \{v\d+:UInt64\}/);
        expect(sql).not.toMatch(/EventTimestamp\s*>=/);
        expect(values).toContain(1_700_000_000_000);
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
        expect(sql).toMatch(SENTINEL_OR_SINCE);
        expect(capturedQuery(statements).values).toContain(0);
      });
    });
  });

  describe("given an operator counting aggregates across tenants", () => {
    describe("when findAggregates is called", () => {
      it("sends an all-tenants statement on the system identity, with its reason", async () => {
        const { repo, statements } = repoCapturingQuery();

        await repo.findAggregates({ aggregateTypes: ["trace"], sinceMs: 1 });

        const { statement, query: sql } = capturedQuery(statements);
        expect(statement).toMatchObject({
          identity: "system",
          kind: "allTenants",
          reason: expect.stringContaining("ops_event_log_search"),
        });
        expect(statement.settings).not.toHaveProperty("SQL_langwatch_tenant_ids");
        expect(sql).not.toContain("TenantId IN");
        expect(sql).toMatch(
          /GROUP BY AggregateType, TenantId ORDER BY AggregateType ASC, TenantId ASC$/,
        );
      });

      it("narrows to the tenants the operator named", async () => {
        const { repo, statements } = repoCapturingQuery([
          { aggregateType: "trace", tenantId: "project_x", aggregateCount: "4" },
        ]);

        const found = await repo.findAggregates({
          aggregateTypes: ["trace"],
          sinceMs: 1,
          tenantIds: ["project_x"],
        });

        const { query: sql, values } = capturedQuery(statements);
        expect(sql).toMatch(/AND TenantId IN \(\{v\d+:Array\(String\)\}\) GROUP BY/);
        expect(values).toContainEqual(["project_x"]);
        expect(found).toEqual([
          { aggregateType: "trace", tenantId: "project_x", aggregateCount: 4 },
        ]);
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

        const { query: sql, values } = capturedQuery(statements);
        expect(sql).toMatch(SENTINEL_OR_SINCE);
        expect(values).toContain(1_700_000_000_000);
        expect(values).toContainEqual(["project_x"]);
        expect(values).toContain("%abc%");
        expect(sql).toMatch(
          /\(like\(AggregateId, \{v\d+:String\}\) OR like\(TenantId, \{v\d+:String\}\)\)/,
        );
      });
    });
  });

  describe("given an operator searching across tenants", () => {
    describe("when searchAggregates is called", () => {
      /** @scenario "One aggregate's history reads its tenant's server, a cross-tenant search the shared one" */
      it("sends an all-tenants statement with its reason, which the member reads on the shared server", async () => {
        const { repo, statements } = repoCapturingQuery();

        await repo.searchAggregates({ query: "abc" });

        const { statement, query: sql } = capturedQuery(statements);
        expect(statement).toMatchObject({
          identity: "system",
          kind: "allTenants",
          reason: expect.stringContaining("ops_event_log_search"),
        });
        expect(statement.settings).not.toHaveProperty("SQL_langwatch_tenant_ids");
        expect(statements[0]?.organizationId).toBeUndefined();
        expect(sql).toMatch(/ORDER BY lastEventTime DESC LIMIT 50$/);
      });
    });
  });

  describe("given a process holding the install's shared endpoint", () => {
    describe("when an operator searches for an aggregate", () => {
      /** @scenario "The operator searches the event log through the composed explorer" */
      it("reads event_log and returns the matching aggregates", async () => {
        const { repo, statements } = repoCapturingQuery([
          {
            aggregateId: "trace-1",
            aggregateType: "trace",
            tenantId: "project-1",
            eventCount: "3",
            lastEventTime: "2026-10-06 10:00:00",
          },
        ]);

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

        const { query: sql, values } = capturedQuery(statements);
        expect(sql).not.toContain("EventOccurredAt");
        expect(values).toEqual(["%abc%", "%abc%"]);
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

        const { query: sql, values } = capturedQuery(statements);
        expect(sql).not.toContain("EventOccurredAt");
        expect(values).toEqual(expect.arrayContaining(["project_test", "agg-1"]));
        expect(sql).toMatch(/ORDER BY EventTimestamp ASC, EventId ASC LIMIT 10$/);
      });

      /** @scenario "One aggregate's history reads its tenant's server, a cross-tenant search the shared one" */
      it("names the aggregate's tenant, so the member reads that tenant's server", async () => {
        const { repo, statements } = repoCapturingQuery();

        await repo.findEventsByAggregate({
          aggregateId: "agg-1",
          tenantId: "project_test",
          limit: 10,
        });

        expect(capturedQuery(statements).statement).toMatchObject({
          identity: "reader",
          kind: "tenant",
          tenantId: "project_test",
          settings: { SQL_langwatch_tenant_ids: "project_test" },
        });
        expect(capturedQuery(statements).query).toContain(
          "FROM event_log WHERE TenantId = {tenantId:String}",
        );
      });
    });
  });
});

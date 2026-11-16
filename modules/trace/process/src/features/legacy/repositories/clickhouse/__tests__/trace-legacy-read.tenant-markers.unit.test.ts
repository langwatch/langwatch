/**
 * @vitest-environment node
 * The by-id and thread reads go through the proof-checked client: every statement names
 * its tenant by marker, never by a `{tenantId:String}` of its own (ADR-177 block C).
 */
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { TraceCanonicalisationService } from "#features/derivation/services/trace-canonicalisation.service";
import { compileProjection } from "#features/projection/rules/trace-projection-compile.rules";

import { ownProof } from "../../../../../__tests__/support/authorization-proofs.fixture.ts";
import { traceSummaryRow } from "../../../../../repositories/clickhouse/__tests__/support/trace-summary-row.support.ts";
import type { TraceClickHouseClient } from "../../../../../repositories/clickhouse/clickhouse.trace-member-client.repository.ts";
import { TraceLegacyReadClickHouseRepository } from "../trace-legacy-read.repository.ts";
import { builtOver, mappedLegacyRead } from "./support/legacy-trace-mapping.support.ts";

type ReadRequest = Parameters<ClickHouseQueryClient["read"]>[0];

const PROJECT_ID = "project-1";
const PROTECTIONS = { canSeeCosts: true, canSeeCapturedInput: true, canSeeCapturedOutput: true };

type Statement = { query: string; query_params?: Record<string, unknown> };

function harness() {
  const routedTo: string[] = [];
  const query = vi.fn(async (statement: Statement) => ({
    json: async (): Promise<unknown[]> => {
      if (statement.query.includes("SELECT DISTINCT TraceId")) return [{ TraceId: "trace-1" }];
      if (statement.query.includes("ts_SpanCount")) {
        return [traceSummaryRow({ ts_OccurredAt: String(Date.now() - 60_000) })];
      }
      return [];
    },
  }));
  const resolveClickHouseClient = async (tenantId: string) => {
    routedTo.push(tenantId);
    return createApiFixture<TraceClickHouseClient>({ query });
  };
  const built: ReadRequest[] = [];
  const builtReader = builtOver(resolveClickHouseClient);
  const read = mappedLegacyRead({
    resolveClickHouseClient,
    reader: {
      read: async (request) => {
        built.push(request);
        return builtReader.read(request);
      },
    },
    traceCanonicalisation: TraceCanonicalisationService.create(),
  });
  const statements = () =>
    query.mock.calls
      .map(([statement]) => statement)
      .filter((statement) => !built.some((request) => request.statement.sql === statement.query));
  return { read, statements, built, routedTo };
}

/** Every read went out built under the proof's own project; no raw statement is left. */
function expectBuiltFencedTo({
  built,
  statements,
  projectId,
}: {
  built: ReadRequest[];
  statements: Statement[];
  projectId: string;
}) {
  expect(built.length).toBeGreaterThan(0);
  for (const request of built) {
    expect(request.statement).toMatchObject({
      kind: "tenant",
      tenantIds: [projectId],
      settings: { SQL_langwatch_tenant_ids: projectId },
    });
    expect(request.statement.sql).not.toContain("{tenantId:String}");
  }
  expect(statements).toEqual([]);
}

describe("TraceLegacyReadClickHouseRepository tenant markers", () => {
  describe("when traces are read by id", () => {
    it("fences every statement to the proof's own project", async () => {
      const { read, statements, built, routedTo } = harness();

      await read.findTracesWithSpans({
        authorization: ownProof({ projectId: PROJECT_ID }),
        projectId: PROJECT_ID,
        traceIds: ["trace-1"],
        protections: PROTECTIONS,
      });

      expectBuiltFencedTo({ built, statements: statements(), projectId: PROJECT_ID });
      expect(new Set(routedTo)).toEqual(new Set([PROJECT_ID]));
    });
  });

  describe("when a thread's traces are read", () => {
    it("fences the thread lookup and the trace reads alike", async () => {
      const { read, statements, built } = harness();

      await read.findTracesByThreadId({
        authorization: ownProof({ projectId: PROJECT_ID }),
        projectId: PROJECT_ID,
        threadId: "thread-1",
        protections: PROTECTIONS,
      });
      await read.findTracesWithSpansByThreadIds({
        authorization: ownProof({ projectId: PROJECT_ID }),
        projectId: PROJECT_ID,
        threadIds: ["thread-1"],
        protections: PROTECTIONS,
      });

      // The thread lookups are built reads under the proof's scope (ADR-202).
      const lookups = built.filter((request) =>
        request.statement.sql.includes("SELECT DISTINCT TraceId"),
      );
      expect(lookups).toHaveLength(2);
      for (const request of built) {
        expect(request.statement).toMatchObject({
          kind: "tenant",
          tenantIds: [PROJECT_ID],
        });
      }
      for (const request of lookups) {
        expect(request.table).toBe("trace_summaries");
        expect(request.statement).toMatchObject({
          kind: "tenant",
          identity: "reader",
          tenantIds: [PROJECT_ID],
          settings: { SQL_langwatch_tenant_ids: PROJECT_ID },
        });
        expect(request.statement.sql).toContain("SELECT DISTINCT TraceId");
        expect(request.statement.sql).toContain("ORDER BY CreatedAt ASC");
      }
      expect(lookups[0]?.statement.sql).toMatch(/Attributes\[\{v\d+:String\}\] = /);
      expect(lookups[1]?.statement.sql).toMatch(/Attributes\[\{v\d+:String\}\] IN /);
      expectBuiltFencedTo({ built, statements: statements(), projectId: PROJECT_ID });
    });
  });

  describe("when the prompt studio span and the field names are read", () => {
    it("builds each read on the project's single-tenant scope", async () => {
      const built: ReadRequest[] = [];
      const repository = TraceLegacyReadClickHouseRepository.create({
        reader: {
          read: async (request) => {
            built.push(request);
            return { rows: [] };
          },
        },
      });

      await repository.findSpanForPromptStudio({
        projectId: PROJECT_ID,
        spanId: "span-1",
        protections: PROTECTIONS,
      });
      await repository.findDistinctFieldNames(PROJECT_ID, 1, 2);

      expect(built.map((request) => request.table)).toEqual([
        "stored_spans",
        "stored_spans",
        "trace_summaries",
        "evaluation_runs",
      ]);
      for (const request of built) {
        expect(request.statement).toMatchObject({
          kind: "tenant",
          identity: "reader",
          settings: { SQL_langwatch_tenant_ids: PROJECT_ID },
        });
        expect(request.statement).toHaveProperty("tenantIds", undefined);
      }
      // The span-id subquery carries its own tenant predicate, as main's did.
      expect(built[0]?.statement.sql.match(/TenantId = /g)).toHaveLength(2);
    });
  });

  describe("when a page's events are projected", () => {
    it("builds the events read under the proof, electing on the event spans alone", async () => {
      const query = vi.fn(async (statement: Statement) => ({
        json: async (): Promise<unknown[]> => {
          if (statement.query.startsWith("SELECT uniq(TraceId) AS total")) return [{ total: "1" }];
          if (statement.query.includes(" AS sortTime ")) return [{ TraceId: "trace-1" }];
          if (statement.query.includes("ts_SpanCount")) {
            return [traceSummaryRow({ ts_OccurredAt: String(Date.now() - 60_000) })];
          }
          return [];
        },
      }));
      const resolveClickHouseClient = async () =>
        createApiFixture<TraceClickHouseClient>({ query });
      const built: ReadRequest[] = [];
      const builtReader = builtOver(resolveClickHouseClient);
      const read = mappedLegacyRead({
        resolveClickHouseClient,
        reader: {
          read: async (request) => {
            built.push(request);
            return builtReader.read(request);
          },
        },
        traceCanonicalisation: TraceCanonicalisationService.create(),
      });
      const endDate = Date.now();

      await read.listAllTracesForProject(
        {
          projectId: PROJECT_ID,
          startDate: endDate - 86_400_000,
          endDate,
          pageSize: 10,
          filters: {},
        },
        PROTECTIONS,
        {
          ownRead: ownProof({ projectId: PROJECT_ID }),
          projection: compileProjection({
            select: ["trace_id", "events.type"],
            protections: PROTECTIONS,
          }).plan,
        },
      );

      const events = built.filter((request) => request.statement.sql.includes("mapFilter("));
      expect(events).toHaveLength(1);
      expect(events[0]?.table).toBe("stored_spans");
      expect(events[0]?.statement).toMatchObject({
        kind: "tenant",
        tenantIds: [PROJECT_ID],
        settings: { SQL_langwatch_tenant_ids: PROJECT_ID },
      });
      const sql = events[0]?.statement.sql ?? "";
      // Main's election filtered on `event.type` too, in the outer read and its subquery.
      expect(sql.match(/mapContains\(SpanAttributes, /g)).toHaveLength(2);
      expect(sql).toMatch(/\(TenantId, TraceId, SpanId, UpdatedAt\) IN/);
      expect(sql).toMatch(/LIMIT 1000 BY TraceId/);
    });
  });

  describe("when the proof names another project than the read", () => {
    it("reads only the proof's project", async () => {
      const { read, statements, built } = harness();

      await read.findTracesWithSpans({
        authorization: ownProof({ projectId: "project-2" }),
        projectId: PROJECT_ID,
        traceIds: ["trace-1"],
        protections: PROTECTIONS,
      });

      expectBuiltFencedTo({ built, statements: statements(), projectId: "project-2" });
    });
  });
});

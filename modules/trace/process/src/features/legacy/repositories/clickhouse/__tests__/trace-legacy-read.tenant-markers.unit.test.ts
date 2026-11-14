/**
 * @vitest-environment node
 * The by-id and thread reads go through the proof-checked client: every statement names
 * its tenant by marker, never by a `{tenantId:String}` of its own (ADR-177 block C).
 */
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { TraceCanonicalisationService } from "#features/derivation/services/trace-canonicalisation.service";

import { ownProof } from "../../../../../__tests__/support/authorization-proofs.fixture.ts";
import { traceSummaryRow } from "../../../../../repositories/clickhouse/__tests__/support/trace-summary-row.support.ts";
import type { TraceClickHouseClient } from "../../../../../repositories/clickhouse/clickhouse.trace-member-client.repository.ts";
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

function expectFencedTo(statements: Statement[], projectId: string) {
  expect(statements.length).toBeGreaterThan(0);
  for (const statement of statements) {
    expect(statement.query).not.toContain("{tenantId:String}");
    expect(statement.query_params?.tenantId).toBeUndefined();
    expect(statement.query_params?.tenantScope_own).toEqual([projectId]);
  }
}

describe("TraceLegacyReadClickHouseRepository tenant markers", () => {
  describe("when traces are read by id", () => {
    it("fences every statement to the proof's own project", async () => {
      const { read, statements, routedTo } = harness();

      await read.findTracesWithSpans({
        authorization: ownProof({ projectId: PROJECT_ID }),
        projectId: PROJECT_ID,
        traceIds: ["trace-1"],
        protections: PROTECTIONS,
      });

      expectFencedTo(statements(), PROJECT_ID);
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
      expect(built).toHaveLength(2);
      for (const request of built) {
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
      expect(built[0]?.statement.sql).toMatch(/Attributes\[\{v\d+:String\}\] = /);
      expect(built[1]?.statement.sql).toMatch(/Attributes\[\{v\d+:String\}\] IN /);
      expectFencedTo(statements(), PROJECT_ID);
    });
  });

  describe("when the proof names another project than the read", () => {
    it("reads only the proof's project", async () => {
      const { read, statements } = harness();

      await read.findTracesWithSpans({
        authorization: ownProof({ projectId: "project-2" }),
        projectId: PROJECT_ID,
        traceIds: ["trace-1"],
        protections: PROTECTIONS,
      });

      expectFencedTo(statements(), "project-2");
    });
  });
});

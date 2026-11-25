/**
 * @vitest-environment node
 * The by-id and thread reads go through the proof-checked client: every statement names
 * its tenant by marker, never by a `{tenantId:String}` of its own (ADR-177 block C).
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { TraceCanonicalisationService } from "#features/derivation/services/trace-canonicalisation.service";

import { ownProof } from "../../../../../__tests__/support/authorization-proofs.fixture.ts";
import { traceSummaryRow } from "../../../../../repositories/clickhouse/__tests__/support/trace-summary-row.support.ts";
import type { TraceClickHouseClient } from "../../../../../repositories/clickhouse/clickhouse.trace-member-client.repository.ts";
import { mappedLegacyRead } from "./support/legacy-trace-mapping.support.ts";

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
  const read = mappedLegacyRead({
    resolveClickHouseClient: async (tenantId) => {
      routedTo.push(tenantId);
      return createApiFixture<TraceClickHouseClient>({ query });
    },
    traceCanonicalisation: TraceCanonicalisationService.create(),
  });
  const statements = () => query.mock.calls.map(([statement]) => statement);
  return { read, statements, routedTo };
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
      const { read, statements } = harness();

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

      expect(statements().filter((s) => s.query.includes("SELECT DISTINCT TraceId"))).toHaveLength(
        2,
      );
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

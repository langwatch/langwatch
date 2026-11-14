/**
 * Every span-tree read is built under the reader's proof (ADR-202): a reader statement over the
 * proof's tenants, carrying the tenant setting.
 * Spec: modules/trace/specs/trace-read-service.feature
 */
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { ownProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import { ClickHouseTraceSpanRepository } from "../trace-span.repository.ts";

type ReadRequest = Parameters<ClickHouseQueryClient["read"]>[0];

const PROJECT = "project-1";
const authorization = ownProof({ projectId: PROJECT });

/** A reader answering no rows, keeping each request it was sent. */
function reader() {
  const requests: ReadRequest[] = [];
  const clickhouse = clickHouseQueryClientDouble({
    async read(request: ReadRequest) {
      requests.push(request);
      return { rows: [] };
    },
  });
  return { repository: ClickHouseTraceSpanRepository.create({ clickhouse }), requests };
}

const reads = {
  "first page": (repository: ClickHouseTraceSpanRepository) =>
    repository.listSummaryPage({ authorization, traceId: "trace-1", limit: 5, occurredAtMs: 9 }),
  "cursor page": (repository: ClickHouseTraceSpanRepository) =>
    repository.listSummaryPage({
      authorization,
      traceId: "trace-1",
      limit: 5,
      cursor: { startTimeMs: 7, spanId: "span-1" },
    }),
  "live delta": (repository: ClickHouseTraceSpanRepository) =>
    repository.findSummarySince({
      authorization,
      traceId: "trace-1",
      sinceUpdatedAtMs: 3,
      occurredAtMs: 9,
    }),
  "evaluation spans": (repository: ClickHouseTraceSpanRepository) =>
    repository.findEvaluationSpans({ authorization, traceId: "trace-1", occurredAtMs: 9 }),
  "evaluation events": (repository: ClickHouseTraceSpanRepository) =>
    repository.findEvaluationEvents({ authorization, traceId: "trace-1", occurredAtMs: 9 }),
  "ingest lag": (repository: ClickHouseTraceSpanRepository) =>
    repository.findIngestLag({ authorization }),
};

describe("ClickHouseTraceSpanRepository statements", () => {
  describe.each(Object.entries(reads))("given the %s read", (_name, read) => {
    describe("when the reader's proof covers its own project", () => {
      /** @scenario "Every span-tree read is fenced by the reader's proof" */
      it("sends one reader statement over the proof's tenants with the tenant setting", async () => {
        const { repository, requests } = reader();

        await read(repository);

        expect(requests).toHaveLength(1);
        expect(requests[0]?.statement).toMatchObject({
          kind: "tenant",
          identity: "reader",
          tenantIds: [PROJECT],
          settings: { SQL_langwatch_tenant_ids: PROJECT },
        });
        expect(requests[0]?.statement.sql).toContain(
          "TenantId IN ({tenantScope_own:Array(String)})",
        );
      });
    });
  });

  describe("given a first page whose trace time is unknown and whose index is not ready", () => {
    /** @scenario "Every span-tree read is fenced by the reader's proof" */
    it("looks the trace's occurrence up in trace_summaries under the same proof", async () => {
      const { repository, requests } = reader();

      await repository.listSummaryPage({ authorization, traceId: "trace-1", limit: 5 });
      const resolve = requests[0]?.idBound?.resolveHint;
      await resolve?.();

      const lookups = requests.filter((request) => request.table === "trace_summaries");
      expect(lookups.length).toBeGreaterThan(0);
      for (const { statement } of lookups) {
        expect(statement).toMatchObject({
          kind: "tenant",
          identity: "reader",
          tenantIds: [PROJECT],
          settings: { SQL_langwatch_tenant_ids: PROJECT },
        });
      }
    });
  });

  describe("given the live delta", () => {
    it("repeats the since filter in the election, as main's statement did", async () => {
      const { repository, requests } = reader();

      await reads["live delta"](repository);

      const [outer = "", election = ""] = (requests[0]?.statement.sql ?? "").split(
        "SELECT TenantId, TraceId, SpanId, max(UpdatedAt)",
      );
      expect(outer).toMatch(/UpdatedAt > fromUnixTimestamp64Milli\(\{v\d+:Int64\}\)/);
      expect(election).toMatch(/UpdatedAt > fromUnixTimestamp64Milli\(\{v\d+:Int64\}\)/);
    });
  });
});

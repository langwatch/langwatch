import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { ownProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import { TraceModelCostService } from "../../../features/derivation/services/trace-model-cost.service.ts";
import { SpanCostService } from "../../../features/span/services/span-cost.service.ts";
import { ScenarioRoleMetricsDerivationService } from "../../../services/scenario-role-metrics-derivation.service.ts";
import { TraceDerivationSpanClickHouseRepository } from "../trace-derivation-span.repository.ts";

/**
 * Spec: specs/scenarios/worker-simulation-pipeline-conversion.feature
 * Per-role metrics read: properties ClickHouse hides (an unpruned
 * partition, a duplicate row) never fail loudly, each just wrongs a number.
 */

type ReadRequest = Parameters<ClickHouseQueryClient["read"]>[0];

/** A reader answering `rows` to every built statement, keeping each request it was sent. */
function reader(rows: unknown[] = []) {
  const requests: ReadRequest[] = [];
  const clickhouse = clickHouseQueryClientDouble({
    async read(request: ReadRequest) {
      requests.push(request);
      return { rows };
    },
  });
  return {
    clickhouse,
    requests,
    get statements() {
      return requests.map((request) => request.statement);
    },
  };
}

/** The one statement a read sent, as the single-tenant reader statement it must be. */
function sentStatement(requests: readonly ReadRequest[]) {
  const [request] = requests;
  if (request === undefined) throw new Error("no statement was sent");
  const { statement } = request;
  if (statement.kind !== "tenant") throw new Error(`a ${statement.kind} statement`);
  return { request, statement };
}

const SPAN_ROW = {
  SpanId: "span-1",
  TraceId: "trace-1",
  TenantId: "project-1",
  ParentSpanId: "",
  ParentTraceId: "",
  ParentIsRemote: 0,
  Sampled: 1,
  StartTimeMs: "1700000000000",
  EndTimeMs: "1700000001000",
  DurationMs: "1000",
  SpanName: "llm",
  SpanKind: 1,
  ResourceAttributes: {},
  SpanAttributes: {},
  StatusCode: 1,
  StatusMessage: "",
  ScopeName: "",
  ScopeVersion: "",
  Cost: 0,
  NonBilledCost: 0,
};

describe("given a trace whose spans back a derivation", () => {
  describe("when the repository reads them", () => {
    it("pins the read to the tenant, the trace and the id index's bound", async () => {
      const ch = reader([SPAN_ROW]);
      const repository = TraceDerivationSpanClickHouseRepository.create({
        clickhouse: ch.clickhouse,
      });

      await repository.findNormalizedSpansByTraceId({
        tenantId: "project-1",
        traceId: "trace-1",
        occurredAtMs: 1_700_000_000_000,
      });

      const { request, statement } = sentStatement(ch.requests);
      expect(statement).toMatchObject({
        identity: "reader",
        tenantId: "project-1",
        tenantIds: undefined,
        settings: { SQL_langwatch_tenant_ids: "project-1" },
      });
      expect(statement.sql).toContain("WHERE TenantId = {tenantId:String}");
      expect(statement.sql).toContain("{{idBound:stored_spans.TraceId:");
      expect(Object.values(statement.params)).toContain("trace-1");
      expect(statement.sql).toContain("LIMIT 10000");
      expect(request).toMatchObject({
        table: "stored_spans",
        idBound: { occurredAtHint: 1_700_000_000_000, fallback: "unbounded" },
      });
    });

    /**
     * `stored_spans` is a `ReplacingMergeTree`: a re-exported span sits as
     * two physical rows until a merge. Returning both would double-count
     * that span's cost and latency in its role's total, silently.
     */
    it("dedups by span id in SQL rather than by returning every physical row", async () => {
      const ch = reader([]);
      const repository = TraceDerivationSpanClickHouseRepository.create({
        clickhouse: ch.clickhouse,
      });

      await repository.findNormalizedSpansByTraceId({
        tenantId: "project-1",
        traceId: "trace-1",
        occurredAtMs: 1_700_000_000_000,
      });

      const { statement } = sentStatement(ch.requests);
      expect(statement.sql).toContain("GROUP BY SpanId");
      expect(statement.sql).toContain("argMax(StartTime, UpdatedAt)");
      expect(statement.sql).not.toContain("LIMIT 1 BY");
    });

    /** Reading the nested groups is what throws `Attempt to read after eof`. */
    it("selects no nested column group", async () => {
      const ch = reader([]);
      const repository = TraceDerivationSpanClickHouseRepository.create({
        clickhouse: ch.clickhouse,
      });

      await repository.findNormalizedSpansByTraceId({
        tenantId: "project-1",
        traceId: "trace-1",
      });

      const { statement } = sentStatement(ch.requests);
      expect(statement.sql).not.toContain("Events.");
      expect(statement.sql).not.toContain("Links.");
    });

    it("refuses a tenantless read", async () => {
      const repository = TraceDerivationSpanClickHouseRepository.create({
        clickhouse: reader().clickhouse,
      });

      await expect(
        repository.findNormalizedSpansByTraceId({ tenantId: "", traceId: "trace-1" }),
      ).rejects.toThrow(/requires a tenantId/i);
    });
  });

  describe("when the repository reads the trace's span events", () => {
    it("reads the proof's own project alone, flattening each span's latest events", async () => {
      const ch = reader([
        { spanId: "span-1", timestamp: "1700000000000", name: "first", attributes: { a: "1" } },
        { spanId: "span-1", timestamp: "1700000000001", name: "second", attributes: null },
      ]);
      const repository = TraceDerivationSpanClickHouseRepository.create({
        clickhouse: ch.clickhouse,
      });

      const events = await repository.findDerivedEventsByTraceId({
        authorization: ownProof({ projectId: "project-1" }),
        traceId: "trace-1",
        occurredAtMs: 1_700_000_000_000,
      });

      expect(events).toEqual([
        { spanId: "span-1", timestamp: 1_700_000_000_000, name: "first", attributes: { a: "1" } },
        { spanId: "span-1", timestamp: 1_700_000_000_001, name: "second", attributes: {} },
      ]);
      const { request, statement } = sentStatement(ch.requests);
      expect(statement).toMatchObject({
        identity: "reader",
        tenantId: "project-1",
        tenantIds: undefined,
        settings: { SQL_langwatch_tenant_ids: "project-1" },
      });
      expect(statement.sql).toContain("WHERE TenantId = {tenantId:String}");
      expect(statement.sql).toContain("{{idBound:stored_spans.TraceId:");
      expect(statement.sql).toContain("GROUP BY SpanId");
      expect(statement.sql).toContain("argMax(`Events.Timestamp`, UpdatedAt)");
      // The events are flattened outside the dedup, never multiplied inside it.
      expect(statement.sql.indexOf("arrayJoin(")).toBeLessThan(statement.sql.indexOf("GROUP BY"));
      expect(request).toMatchObject({
        idBound: { occurredAtHint: 1_700_000_000_000, fallback: "unbounded" },
      });
    });
  });
});

describe("given the per-role derivation over one trace", () => {
  describe("when several subscribers of one coalesced batch ask at the same fold version", () => {
    /**
     * The all-spans read is multi-MB, and a coalesced batch fires its
     * subscribers once per event. Without the memo, the same read runs per
     * span — the amplification that saturated ClickHouse during a drain.
     */
    it("reads storage once", async () => {
      const ch = reader([SPAN_ROW]);
      const service = ScenarioRoleMetricsDerivationService.create({
        spans: TraceDerivationSpanClickHouseRepository.create({
          clickhouse: ch.clickhouse,
        }),
        spanCosts: SpanCostService.create({
          modelCosts: TraceModelCostService.create(),
        }),
      });

      await Promise.all([
        service.derive({ tenantId: "project-1", traceId: "trace-1", foldVersion: 7 }),
        service.derive({ tenantId: "project-1", traceId: "trace-1", foldVersion: 7 }),
        service.derive({ tenantId: "project-1", traceId: "trace-1", foldVersion: 7 }),
      ]);

      expect(ch.statements).toHaveLength(1);
    });

    it("reads again once the fold has advanced", async () => {
      const ch = reader([SPAN_ROW]);
      const service = ScenarioRoleMetricsDerivationService.create({
        spans: TraceDerivationSpanClickHouseRepository.create({
          clickhouse: ch.clickhouse,
        }),
        spanCosts: SpanCostService.create({
          modelCosts: TraceModelCostService.create(),
        }),
      });

      await service.derive({ tenantId: "project-1", traceId: "trace-1", foldVersion: 7 });
      await service.derive({ tenantId: "project-1", traceId: "trace-1", foldVersion: 8 });

      expect(ch.statements).toHaveLength(2);
    });

    /** A live read with no watermark must always hit storage. */
    it("bypasses the memo when no fold version is supplied", async () => {
      const ch = reader([SPAN_ROW]);
      const service = ScenarioRoleMetricsDerivationService.create({
        spans: TraceDerivationSpanClickHouseRepository.create({
          clickhouse: ch.clickhouse,
        }),
        spanCosts: SpanCostService.create({
          modelCosts: TraceModelCostService.create(),
        }),
      });

      await service.derive({ tenantId: "project-1", traceId: "trace-1" });
      await service.derive({ tenantId: "project-1", traceId: "trace-1" });

      expect(ch.statements).toHaveLength(2);
    });
  });
});

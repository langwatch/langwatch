import { describe, expect, it, vi } from "vitest";

import { ModelCatalogTraceModelCostAdapter } from "../../../services/model-catalog.trace-model-cost.service.ts";
import { ScenarioRoleMetricsDerivationService } from "../../../services/scenario-role-metrics-derivation.service.ts";
import { SpanCostService } from "../../../services/span-cost.service.ts";
import { TraceDerivationSpanClickHouseRepository } from "../trace-derivation-span.repository.ts";

/**
 * Spec: specs/scenarios/worker-simulation-pipeline-conversion.feature
 * Per-role metrics read: properties ClickHouse hides (an unpruned
 * partition, a duplicate row) never fail loudly, each just wrongs a number.
 */

type ChQuery = { query: string; query_params?: Record<string, unknown> };

function client(rows: unknown[] = []) {
  const query = vi.fn(async (_request: ChQuery) => ({ json: async () => rows }));
  return { query, insert: vi.fn() };
}

const SPAN_ROW = {
  SpanId: "span-1",
  TraceId: "trace-1",
  TenantId: "project-1",
  ParentSpanId: "",
  ParentTraceId: "",
  ParentIsRemote: false,
  Sampled: true,
  StartTimeMs: "1700000000000",
  EndTimeMs: "1700000001000",
  DurationMs: 1000,
  SpanName: "llm",
  SpanKind: "INTERNAL",
  ResourceAttributes: {},
  SpanAttributes: {},
  StatusCode: "OK",
  StatusMessage: "",
  ScopeName: "",
  ScopeVersion: "",
  Cost: 0,
  NonBilledCost: 0,
};

describe("given a trace whose spans back a derivation", () => {
  describe("when the repository reads them", () => {
    it("pins the read to the tenant, the trace and the partition window", async () => {
      const ch = client([SPAN_ROW]);
      const repository = TraceDerivationSpanClickHouseRepository.create({
        resolveClient: async () => ch as never,
      });

      await repository.findNormalizedSpansByTraceId({
        tenantId: "project-1",
        traceId: "trace-1",
        occurredAtMs: 1_700_000_000_000,
      });

      const call = ch.query.mock.calls[0]![0] as Required<ChQuery>;
      expect(call.query).toContain("WHERE TenantId = {tenantId:String}");
      expect(call.query).toContain("AND TraceId = {traceId:String}");
      expect(call.query).toContain("AND StartTime BETWEEN");
      expect(call.query_params).toMatchObject({
        tenantId: "project-1",
        traceId: "trace-1",
        limit: 10_000,
      });
    });

    /**
     * `stored_spans` is a `ReplacingMergeTree`: a re-exported span sits as
     * two physical rows until a merge. Returning both would double-count
     * that span's cost and latency in its role's total, silently.
     */
    it("dedups by span id in SQL rather than by returning every physical row", async () => {
      const ch = client([]);
      const repository = TraceDerivationSpanClickHouseRepository.create({
        resolveClient: async () => ch as never,
      });

      await repository.findNormalizedSpansByTraceId({
        tenantId: "project-1",
        traceId: "trace-1",
        occurredAtMs: 1_700_000_000_000,
      });

      const call = ch.query.mock.calls[0]![0];
      expect(call.query).toContain("GROUP BY SpanId");
      expect(call.query).toContain("argMax(StartTime, UpdatedAt)");
      expect(call.query).not.toContain("LIMIT 1 BY");
    });

    /** Reading the nested groups is what throws `Attempt to read after eof`. */
    it("selects no nested column group", async () => {
      const ch = client([]);
      const repository = TraceDerivationSpanClickHouseRepository.create({
        resolveClient: async () => ch as never,
      });

      await repository.findNormalizedSpansByTraceId({
        tenantId: "project-1",
        traceId: "trace-1",
      });

      const call = ch.query.mock.calls[0]![0];
      expect(call.query).not.toContain("Events.");
      expect(call.query).not.toContain("Links.");
    });

    it("refuses a tenantless read", async () => {
      const repository = TraceDerivationSpanClickHouseRepository.create({
        resolveClient: async () => client() as never,
      });

      await expect(
        repository.findNormalizedSpansByTraceId({ tenantId: "", traceId: "trace-1" }),
      ).rejects.toThrow(/requires a tenantId/i);
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
      const ch = client([SPAN_ROW]);
      const service = ScenarioRoleMetricsDerivationService.create({
        spans: TraceDerivationSpanClickHouseRepository.create({
          resolveClient: async () => ch as never,
        }),
        spanCosts: SpanCostService.create({
          modelCosts: ModelCatalogTraceModelCostAdapter.create(),
        }),
      });

      await Promise.all([
        service.derive({ tenantId: "project-1", traceId: "trace-1", foldVersion: 7 }),
        service.derive({ tenantId: "project-1", traceId: "trace-1", foldVersion: 7 }),
        service.derive({ tenantId: "project-1", traceId: "trace-1", foldVersion: 7 }),
      ]);

      expect(ch.query).toHaveBeenCalledOnce();
    });

    it("reads again once the fold has advanced", async () => {
      const ch = client([SPAN_ROW]);
      const service = ScenarioRoleMetricsDerivationService.create({
        spans: TraceDerivationSpanClickHouseRepository.create({
          resolveClient: async () => ch as never,
        }),
        spanCosts: SpanCostService.create({
          modelCosts: ModelCatalogTraceModelCostAdapter.create(),
        }),
      });

      await service.derive({ tenantId: "project-1", traceId: "trace-1", foldVersion: 7 });
      await service.derive({ tenantId: "project-1", traceId: "trace-1", foldVersion: 8 });

      expect(ch.query).toHaveBeenCalledTimes(2);
    });

    /** A live read with no watermark must always hit storage. */
    it("bypasses the memo when no fold version is supplied", async () => {
      const ch = client([SPAN_ROW]);
      const service = ScenarioRoleMetricsDerivationService.create({
        spans: TraceDerivationSpanClickHouseRepository.create({
          resolveClient: async () => ch as never,
        }),
        spanCosts: SpanCostService.create({
          modelCosts: ModelCatalogTraceModelCostAdapter.create(),
        }),
      });

      await service.derive({ tenantId: "project-1", traceId: "trace-1" });
      await service.derive({ tenantId: "project-1", traceId: "trace-1" });

      expect(ch.query).toHaveBeenCalledTimes(2);
    });
  });
});

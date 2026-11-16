// The sidebar's facet reads as built statements: each fenced by the proof with the tenant setting,
// the filter applied after the election on summaries and as a trace-pair subquery elsewhere; the
// companion integration suite proves the counts.
import {
  idIndexedClientDouble,
  type ScriptedStatements,
} from "@langwatch/clickhouse-client/testing";
import { describe, expect, it, vi } from "vitest";

import { ownProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import {
  FACET_CATEGORICAL_EXPRESSIONS,
  FACET_RANGE_EXPRESSIONS,
} from "../../../features/facet/repositories/clickhouse/clickhouse.trace-facet-expressions.mapper.ts";
import { FACET_REGISTRY } from "../../../features/facet/repositories/clickhouse/clickhouse.trace-facet-registry.mapper.ts";
import { traceFilterCompileFor } from "../../../services/__tests__/fixtures/trace-query-services.fixtures.ts";
import { TRACE_ID_INDEXES } from "../clickhouse.trace-id-indexes.database.ts";
import { TraceListClickHouseRepository } from "../trace-list.repository.ts";

function makeRepo() {
  const client = idIndexedClientDouble({
    indexes: TRACE_ID_INDEXES,
    driver: { execute: vi.fn<ScriptedStatements["execute"]>(async () => ({ rows: [] })) },
  });
  const repo = TraceListClickHouseRepository.create({
    reader: client,
  });
  return { repo, read: vi.spyOn(client, "read") };
}

const authorization = ownProof({ projectId: "tenant-1" });
const timeRange = { from: 1_000, to: 2_000 };
const compileFilter = traceFilterCompileFor({ queryText: "service:api", timeRange });

describe("the facet reads' built statements", () => {
  describe("when every facet read runs under a filter", () => {
    it("sends each as a tenant statement fenced by the proof with the tenant setting", async () => {
      const { repo, read } = makeRepo();
      const scan = { authorization, timeRange, compileFilter };

      await repo.findBatchedFacets({
        ...scan,
        table: "trace_summaries",
        categoricalKeys: ["status", "service"],
        rangeKeys: ["cost"],
        topN: 10,
      });
      await repo.findCategoricalFacet({
        ...scan,
        table: "evaluation_runs",
        facetKey: "evaluatorLabel",
        limit: 10,
        offset: 0,
      });
      await repo.findDiscreteValues({
        ...scan,
        table: "trace_summaries",
        facetKey: "spans",
        limit: 10,
      });
      await repo.findRangeStatsForTable({
        ...scan,
        table: "evaluation_runs",
        facetKey: "evaluatorScore",
      });

      expect(read).toHaveBeenCalledTimes(5);
      for (const [{ statement }] of read.mock.calls) {
        expect(statement).toMatchObject({
          identity: "reader",
          kind: "tenant",
          tenantId: "tenant-1",
        });
        expect(statement.settings).toMatchObject({ SQL_langwatch_tenant_ids: "tenant-1" });
        expect(statement.sql).not.toContain("{{tenantScope");
      }
    });
  });

  describe("when a facet on another table is filtered", () => {
    it("narrows it to the trace pairs whose latest summary in the window matches", async () => {
      const { repo, read } = makeRepo();

      await repo.findCategoricalFacet({
        authorization,
        timeRange,
        compileFilter,
        table: "evaluation_runs",
        facetKey: "evaluatorLabel",
        limit: 10,
        offset: 0,
      });

      const { sql } = read.mock.calls[0]![0].statement;
      expect(sql).toContain(
        "tuple(TenantId, TraceId) IN (SELECT TenantId, TraceId FROM trace_summaries",
      );
      expect(sql).toContain("GROUP BY TenantId, TraceId");
    });
  });

  describe("when a facet key has no expression on its table", () => {
    it("refuses the read rather than counting nothing", async () => {
      const { repo } = makeRepo();

      await expect(
        repo.findRangeStatsForTable({
          authorization,
          timeRange,
          table: "stored_spans",
          facetKey: "cost",
        }),
      ).rejects.toThrow("No facet expression for stored_spans.cost");
    });
  });

  describe("given the facet registry", () => {
    it("gives every expression facet a builder expression on its own table", () => {
      const missing = FACET_REGISTRY.filter((def) => "expression" in def)
        .filter((def) => {
          const expressions =
            def.kind === "range" ? FACET_RANGE_EXPRESSIONS : FACET_CATEGORICAL_EXPRESSIONS;
          return !(def.key in expressions[def.table]);
        })
        .map((def) => `${def.table}.${def.key}`);

      expect(missing).toEqual([]);
    });
  });
});

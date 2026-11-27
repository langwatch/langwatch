/**
 * The discovery pass sends its batched span facets to span_analytics inside the floor.
 * @see specs/traces-v2/facet-light-twin.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { SpanAnalyticsFloor, TraceListRead } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { ownProof } from "../../__tests__/support/authorization-proofs.fixture.ts";
import { CLICKHOUSE_FACET_CATALOG } from "../../features/facet/repositories/clickhouse/clickhouse.trace-facet-registry.mapper.ts";
import type { ExpressionCategoricalDef } from "../../features/facet/rules/trace-facet-registry.rules.ts";
import { TraceFacetDescriptorService } from "../../features/facet/services/trace-facet-descriptor.service.ts";
import { TraceTopicNamingService } from "../../features/topic/services/trace-topic-naming.service.ts";
import { TraceDiscoverTaskService } from "../trace-discover-task.service.ts";

const FLOOR = "2026-10-01T00:00:00.000Z";

async function tablesRead({
  lightFloor,
  fromMs,
}: {
  lightFloor?: () => Promise<SpanAnalyticsFloor>;
  fromMs: number;
}) {
  const reads: { table: string; expressions: string[] }[] = [];
  const repository = createApiFixture<TraceListRead>({
    findBatchedFacets: async (params) => {
      reads.push({
        table: params.table,
        expressions: params.categoricalSpecs.map((spec) => spec.expression),
      });
      return { categoricals: {}, ranges: {} };
    },
  });
  const tasks = TraceDiscoverTaskService.create({
    repository,
    descriptors: TraceFacetDescriptorService.create({
      repository,
      topicNaming: TraceTopicNamingService.create({
        topicNames: { findNamesByIds: async () => new Map() },
      }),
      facets: CLICKHOUSE_FACET_CATALOG,
    }),
    facets: CLICKHOUSE_FACET_CATALOG,
    ...(lightFloor ? { lightFloor } : {}),
  });
  const spanSlot = {
    table: "stored_spans" as const,
    filterWhere: undefined,
    categoricals: CLICKHOUSE_FACET_CATALOG.registry.filter(
      (def) => def.table === "stored_spans" && def.kind === "categorical" && "expression" in def,
    ) as ExpressionCategoricalDef[],
    ranges: [],
  };
  const [task] = tasks.batchTasks(
    {
      authorization: ownProof({ projectId: "project_1" }),
      timeRange: { from: fromMs, to: fromMs + 3_600_000 },
    },
    new Map([["stored_spans", spanSlot]]),
  );
  await task!.run();
  return reads;
}

describe("given a discovery pass over the span facets", () => {
  describe("when span_analytics holds the whole window", () => {
    /** @scenario "A span facet pass inside the span_analytics floor reads span_analytics" */
    it("reads span_analytics without the attribute map", async () => {
      const reads = await tablesRead({
        lightFloor: async () => ({ from: FLOOR, rebuilding: false }),
        fromMs: Date.parse(FLOOR) + 1,
      });

      expect(reads).toHaveLength(1);
      expect(reads[0]!.table).toBe("span_analytics");
      expect(reads[0]!.expressions.join(" ")).not.toContain("SpanAttributes");
    });
  });

  describe("when the floor read fails", () => {
    /** @scenario "While span_analytics is rebuilding the span facets read stored_spans" */
    it("reads stored_spans", async () => {
      const reads = await tablesRead({
        lightFloor: async () => {
          throw new Error("ledger unavailable");
        },
        fromMs: Date.parse(FLOOR) + 1,
      });

      expect(reads[0]!.table).toBe("stored_spans");
    });
  });
});

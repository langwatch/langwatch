/**
 * A span facet's values read span_analytics inside its floor, like the batched discover read.
 * @see specs/traces-v2/facet-light-twin.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { SpanAnalyticsFloor, TraceListRead } from "@langwatch/trace-contract";
import { nanoid } from "nanoid";
import { describe, expect, it, vi } from "vitest";

import { ownProof } from "../../../../__tests__/support/authorization-proofs.fixture.ts";
import { TraceTopicNamingService } from "../../../topic/services/trace-topic-naming.service.ts";
import { CLICKHOUSE_FACET_CATALOG } from "../../repositories/clickhouse/clickhouse.trace-facet-registry.mapper.ts";
import { TraceFacetValuesService } from "../trace-facet-values.service.ts";

const FLOOR_MS = Date.UTC(2026, 9, 1);

async function spanTypeValuesRead({
  lightFloor,
  fromMs,
}: {
  lightFloor: () => Promise<SpanAnalyticsFloor>;
  fromMs: number;
}) {
  const findCategoricalFacet = vi.fn<TraceListRead["findCategoricalFacet"]>(async () => ({
    values: [],
    totalDistinct: 0,
  }));
  const service = TraceFacetValuesService.create({
    repository: createApiFixture<TraceListRead>({ findCategoricalFacet }, "list repository"),
    topicNaming: TraceTopicNamingService.create({
      topicNames: { findNamesByIds: async () => new Map() },
    }),
    facets: CLICKHOUSE_FACET_CATALOG,
    lightFloor,
  });
  await service.getFacetValues({
    authorization: ownProof({ projectId: `project-${nanoid()}` }),
    timeRange: { from: fromMs, to: fromMs + 86_400_000 },
    facetKey: "spanType",
    limit: 10,
    offset: 0,
  });
  return findCategoricalFacet.mock.calls[0]![0];
}

describe("given the span type facet's values", () => {
  describe("when the window starts at or after the span_analytics floor", () => {
    /** @scenario "One span facet's values inside the floor read span_analytics" */
    it("reads span_analytics with its SpanType column", async () => {
      const read = await spanTypeValuesRead({
        lightFloor: async () => ({ from: new Date(FLOOR_MS).toISOString(), rebuilding: false }),
        fromMs: FLOOR_MS,
      });

      expect(read).toMatchObject({ table: "span_analytics", facetExpression: "SpanType" });
    });
  });

  describe("when the floor cannot be read", () => {
    /** @scenario "One span facet's values inside the floor read span_analytics" */
    it("reads stored_spans with the map expression", async () => {
      const read = await spanTypeValuesRead({
        lightFloor: () => Promise.reject(new Error("ledger down")),
        fromMs: FLOOR_MS,
      });

      expect(read).toMatchObject({
        table: "stored_spans",
        facetExpression: "SpanAttributes['langwatch.span.type']",
      });
    });
  });
});

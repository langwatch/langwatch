/**
 * @vitest-environment node
 * Facet value routing by attribute prefix (attribute, event.attribute,
 * span.attribute) to their respective stores.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryNullTraceListRepository } from "../../repositories/memory/memory.null-trace-list.repository.ts";
import { TraceListService } from "../trace-list-read.service.ts";

const emptyResult = { values: [], totalDistinct: 0 };

function makeService() {
  const repository = Object.assign(MemoryNullTraceListRepository.create(), {
    findAttributeValues: vi.fn().mockResolvedValue(emptyResult),
    findEventAttributeValues: vi.fn().mockResolvedValue(emptyResult),
    findSpanAttributeValues: vi.fn().mockResolvedValue(emptyResult),
  });
  const service = TraceListService.create({
    repository,
    evaluations: undefined as never,
    topicService: undefined as never,
  });
  return { repository, service };
}

// Unique tenant per test keeps the module-level facet-values cache cold.
let seq = 0;
function params(facetKey: string) {
  return {
    tenantId: `project_routing_${seq++}`,
    timeRange: { from: 0, to: 1 },
    facetKey,
    limit: 30,
    offset: 0,
  };
}

beforeEach(() => {
  seq++;
});

describe("TraceListService facet-value routing", () => {
  describe("given an event-attribute facet key", () => {
    /** @scenario "Expanding an event-attribute key lists values observed on events" */
    it("routes event.attribute.<key> to the event-attribute value lookup", async () => {
      const { repository, service } = makeService();

      await service.getFacetValues(params("event.attribute.event.metrics.vote"));

      expect(repository.findEventAttributeValues).toHaveBeenCalledWith(
        expect.objectContaining({ attributeKey: "event.metrics.vote" }),
      );
      expect(repository.findAttributeValues).not.toHaveBeenCalled();
    });

    it("rejects keys outside the attribute-key whitelist", async () => {
      const { repository, service } = makeService();

      await expect(service.getFacetValues(params("event.attribute.bad'key"))).rejects.toThrow(
        /Invalid attribute key/,
      );
      expect(repository.findEventAttributeValues).not.toHaveBeenCalled();
    });
  });

  describe("given a span-attribute facet key", () => {
    /** @scenario "Expanding a span-attribute key lists values observed on spans" */
    it("routes span.attribute.<key> to the span-attribute value lookup", async () => {
      const { repository, service } = makeService();

      await service.getFacetValues(params("span.attribute.gen_ai.request.model"));

      expect(repository.findSpanAttributeValues).toHaveBeenCalledWith(
        expect.objectContaining({ attributeKey: "gen_ai.request.model" }),
      );
      expect(repository.findAttributeValues).not.toHaveBeenCalled();
    });
  });

  describe("given the legacy trace-attribute facet key", () => {
    it("keeps routing attribute.<key> to trace_summaries.Attributes", async () => {
      const { repository, service } = makeService();

      await service.getFacetValues(params("attribute.langwatch.user_id"));

      expect(repository.findAttributeValues).toHaveBeenCalledWith(
        expect.objectContaining({ attributeKey: "langwatch.user_id" }),
      );
      expect(repository.findEventAttributeValues).not.toHaveBeenCalled();
      expect(repository.findSpanAttributeValues).not.toHaveBeenCalled();
    });
  });
});

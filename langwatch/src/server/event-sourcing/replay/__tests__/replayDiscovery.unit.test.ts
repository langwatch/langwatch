import { describe, it, expect } from "vitest";
import { filterDiscoveredByAggregateIds } from "../replayDiscovery";
import type { DiscoveredAggregate } from "../replayEventLoader";

function agg(tenantId: string, aggregateId: string): DiscoveredAggregate {
  return { tenantId, aggregateType: "scenario", aggregateId };
}

function buildDiscovery() {
  const tenantA = [agg("tenant-a", "agg-1"), agg("tenant-a", "agg-2")];
  const tenantB = [agg("tenant-b", "agg-3")];
  const allAggregates = [...tenantA, ...tenantB];
  const byTenant = new Map<string, DiscoveredAggregate[]>([
    ["tenant-a", tenantA],
    ["tenant-b", tenantB],
  ]);
  return { allAggregates, byTenant };
}

describe("filterDiscoveredByAggregateIds", () => {
  describe("given discovered aggregates across two tenants", () => {
    describe("when an allow-list matches a subset of aggregates", () => {
      it("returns only the matching aggregates", () => {
        const { allAggregates, byTenant } = buildDiscovery();

        const filtered = filterDiscoveredByAggregateIds({ allAggregates, byTenant, aggregateIds: ["agg-1", "agg-3"] });

        expect(filtered.map((a) => a.aggregateId)).toEqual(["agg-1", "agg-3"]);
      });

      it("mutates byTenant in place to keep only matching aggregates", () => {
        const { allAggregates, byTenant } = buildDiscovery();

        filterDiscoveredByAggregateIds({ allAggregates, byTenant, aggregateIds: ["agg-1", "agg-3"] });

        expect(byTenant.get("tenant-a")?.map((a) => a.aggregateId)).toEqual([
          "agg-1",
        ]);
        expect(byTenant.get("tenant-b")?.map((a) => a.aggregateId)).toEqual([
          "agg-3",
        ]);
      });
    });

    describe("when the allow-list empties a tenant", () => {
      it("deletes that tenant from the byTenant map", () => {
        const { allAggregates, byTenant } = buildDiscovery();

        const filtered = filterDiscoveredByAggregateIds({ allAggregates, byTenant, aggregateIds: ["agg-3"] });

        expect(byTenant.has("tenant-a")).toBe(false);
        expect(byTenant.get("tenant-b")?.map((a) => a.aggregateId)).toEqual([
          "agg-3",
        ]);
        expect(filtered.map((a) => a.aggregateId)).toEqual(["agg-3"]);
      });
    });

    describe("when the allow-list matches nothing", () => {
      it("returns no aggregates and empties the byTenant map", () => {
        const { allAggregates, byTenant } = buildDiscovery();

        const filtered = filterDiscoveredByAggregateIds({ allAggregates, byTenant, aggregateIds: ["agg-nope"] });

        expect(filtered).toEqual([]);
        expect(byTenant.size).toBe(0);
      });
    });

    describe("when the allow-list is undefined", () => {
      it("returns the input unchanged and leaves byTenant untouched", () => {
        const { allAggregates, byTenant } = buildDiscovery();

        const filtered = filterDiscoveredByAggregateIds({ allAggregates, byTenant, aggregateIds: undefined });

        expect(filtered).toBe(allAggregates);
        expect(byTenant.size).toBe(2);
        expect(byTenant.get("tenant-a")).toHaveLength(2);
        expect(byTenant.get("tenant-b")).toHaveLength(1);
      });
    });

    describe("when the allow-list is empty", () => {
      it("returns the input unchanged and leaves byTenant untouched", () => {
        const { allAggregates, byTenant } = buildDiscovery();

        const filtered = filterDiscoveredByAggregateIds({ allAggregates, byTenant, aggregateIds: [] });

        expect(filtered).toBe(allAggregates);
        expect(byTenant.size).toBe(2);
        expect(byTenant.get("tenant-a")).toHaveLength(2);
        expect(byTenant.get("tenant-b")).toHaveLength(1);
      });
    });
  });
});

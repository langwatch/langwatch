import { describe, expect, it } from "vitest";
import {
  MalformedGroupKeyError,
  parseGroupKey,
  renderGroupKey,
  scopeCanBatch,
} from "./groupKey";
import type { GroupKey } from "./groupKey.types";

/**
 * The group key is the concurrency contract (ADR-100), so these tests are about
 * identity: two descriptions that mean different things must never render to
 * one lane, and a rendered key must mean exactly one thing.
 */

const hostile = [
  "plain",
  "with/separator",
  "with{brace",
  "brace}close",
  "back\\slash",
  "all\\the/{things}",
  "",
  "trace-2Zk9\\/{}",
];

describe("group key", () => {
  describe("given a descriptor", () => {
    const cases: GroupKey[] = [
      {
        tenantId: "tenant-1",
        lane: { kind: "fold", name: "traceSummary" },
        scope: { kind: "aggregate", aggregateType: "trace", aggregateId: "t1" },
      },
      {
        tenantId: "tenant-1",
        lane: { kind: "map", name: "spanStorage" },
        scope: { kind: "event", eventId: "evt-1" },
      },
      {
        tenantId: "tenant-1",
        lane: { kind: "map", name: "traceAnalyticsRollup" },
        scope: { kind: "partition", parts: ["trace", "t1", "2026-W31"] },
      },
      {
        tenantId: "tenant-1",
        lane: { kind: "subscriber", name: "projectMetadata" },
        scope: { kind: "global" },
      },
      {
        tenantId: "tenant-1",
        lane: { kind: "command" },
        scope: { kind: "aggregate", aggregateType: "trace", aggregateId: "t1" },
      },
      {
        tenantId: "tenant-1",
        lane: { kind: "command", name: "contributeSpanFacts" },
        scope: { kind: "aggregate", aggregateType: "session", aggregateId: "s1" },
      },
      {
        tenantId: "tenant-1",
        lane: { kind: "processManager", name: "scenarioExecution" },
        scope: { kind: "aggregate", aggregateType: "run", aggregateId: "r1" },
      },
      {
        tenantId: "tenant-1",
        lane: { kind: "job", name: "blobSweep" },
        scope: { kind: "partition", parts: [] },
      },
    ];

    /** @scenario a key can be read back to say which tenant, lane and scope it names */
    it("round-trips every lane and scope shape", () => {
      for (const key of cases) {
        expect(parseGroupKey(renderGroupKey(key))).toEqual(key);
      }
    });

    it("round-trips values containing separators, braces and backslashes", () => {
      for (const value of hostile) {
        const key: GroupKey = {
          tenantId: value,
          lane: { kind: "fold", name: value },
          scope: {
            kind: "aggregate",
            aggregateType: value,
            aggregateId: value,
          },
        };
        expect(parseGroupKey(renderGroupKey(key))).toEqual(key);
      }
    });

    /** @scenario every key belonging to one lane is stored together */
    it("carries exactly one hash tag, with no brace inside it", () => {
      for (const value of hostile) {
        const rendered = renderGroupKey({
          tenantId: value,
          lane: { kind: "fold", name: value },
          scope: { kind: "partition", parts: [value, value] },
        });
        const inner = rendered.slice(1, -1);
        expect(rendered.startsWith("{")).toBe(true);
        expect(rendered.endsWith("}")).toBe(true);
        expect(inner.includes("{")).toBe(false);
        expect(inner.includes("}")).toBe(false);
      }
    });
  });

  describe("when two descriptors differ", () => {
    /** @scenario a value containing punctuation cannot merge two lanes */
    it("keeps a separator in a value from merging two lanes", () => {
      const asOneValue = renderGroupKey({
        tenantId: "t",
        lane: { kind: "fold", name: "f" },
        scope: { kind: "partition", parts: ["a/b"] },
      });
      const asTwoValues = renderGroupKey({
        tenantId: "t",
        lane: { kind: "fold", name: "f" },
        scope: { kind: "partition", parts: ["a", "b"] },
      });
      expect(asOneValue).not.toEqual(asTwoValues);
    });

    it("keeps a partition scope distinct from an aggregate scope", () => {
      const partition = renderGroupKey({
        tenantId: "t",
        lane: { kind: "fold", name: "f" },
        scope: { kind: "partition", parts: ["trace", "t1"] },
      });
      const aggregate = renderGroupKey({
        tenantId: "t",
        lane: { kind: "fold", name: "f" },
        scope: { kind: "aggregate", aggregateType: "trace", aggregateId: "t1" },
      });
      expect(partition).not.toEqual(aggregate);
    });

    it("keeps a named command lane distinct from the serialised one", () => {
      const scope = {
        kind: "aggregate",
        aggregateType: "trace",
        aggregateId: "t1",
      } as const;
      expect(
        renderGroupKey({ tenantId: "t", lane: { kind: "command" }, scope }),
      ).not.toEqual(
        renderGroupKey({
          tenantId: "t",
          lane: { kind: "command", name: "record" },
          scope,
        }),
      );
    });

    /** @scenario two tenants never share a lane */
    it("separates tenants even under a global scope", () => {
      const lane = { kind: "subscriber", name: "ingest" } as const;
      const scope = { kind: "global" } as const;
      expect(
        renderGroupKey({ tenantId: "tenant-a", lane, scope }),
      ).not.toEqual(renderGroupKey({ tenantId: "tenant-b", lane, scope }));
    });

    it("separates lanes of different kinds sharing a name", () => {
      const scope = {
        kind: "aggregate",
        aggregateType: "trace",
        aggregateId: "t1",
      } as const;
      expect(
        renderGroupKey({ tenantId: "t", lane: { kind: "fold", name: "x" }, scope }),
      ).not.toEqual(
        renderGroupKey({ tenantId: "t", lane: { kind: "map", name: "x" }, scope }),
      );
    });
  });

  describe("when the rendered key is malformed", () => {
    it("rejects a key with no hash tag", () => {
      expect(() => parseGroupKey("t/fold/x/agg/trace/t1")).toThrow(
        MalformedGroupKeyError,
      );
    });

    /** @scenario a key that did not come from the platform is rejected */
    it("rejects an unknown lane kind", () => {
      expect(() => parseGroupKey("{t/reactor/x/agg/trace/t1}")).toThrow(
        MalformedGroupKeyError,
      );
    });

    it("rejects an unknown scope kind", () => {
      expect(() => parseGroupKey("{t/fold/x/window/t1}")).toThrow(
        MalformedGroupKeyError,
      );
    });

    it("rejects an aggregate scope missing its id", () => {
      expect(() => parseGroupKey("{t/fold/x/agg/trace}")).toThrow(
        MalformedGroupKeyError,
      );
    });
  });

  describe("when deciding whether a lane may batch", () => {
    /** @scenario a lane scoped to one event can never gather a batch */
    it("refuses a batch for an event scope, which is one lane per event", () => {
      expect(scopeCanBatch({ kind: "event", eventId: "e1" })).toBe(false);
    });

    it("allows a batch for every scope that can hold more than one item", () => {
      expect(
        scopeCanBatch({
          kind: "aggregate",
          aggregateType: "trace",
          aggregateId: "t1",
        }),
      ).toBe(true);
      expect(scopeCanBatch({ kind: "partition", parts: ["a"] })).toBe(true);
      expect(scopeCanBatch({ kind: "global" })).toBe(true);
    });
  });
});

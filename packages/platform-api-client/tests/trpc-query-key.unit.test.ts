import { getQueryKey } from "@trpc/react-query";
import { describe, expect, it } from "vitest";
import { createFeatureApi } from "../src/feature-api";
import { trpcQueryFilter, trpcQueryKey } from "../src/trpc-query-key";

/**
 * The one property the whole feature-web data-access pattern rests on: a query
 * a feature package registers and a query the application registers land on the
 * SAME React Query cache entry, so invalidations cross the boundary in both
 * directions during the migration.
 *
 * Two things could break it. A future `@trpc/react-query` could change its key
 * encoding, which would silently split every migrated hook from its
 * un-migrated siblings. Or `trpcQueryKey` — the escape hatch for procedures a
 * feature's map does not declare yet — could drift from that encoding. Both are
 * invisible at runtime: nothing throws, queries just stop refetching. So the
 * expectations here are taken from tRPC's own `getQueryKey`, not written out by
 * hand.
 */

type ProbeApiMap = {
  tracesV2: {
    header: { query: { input: { projectId: string; traceId: string }; output: { name: string } } };
    list: { query: { input: { projectId: string }; output: { name: string }[] } };
    changeName: {
      mutation: { input: { projectId: string; traceId: string; newName: string }; output: null };
    };
  };
};

const probeApi = createFeatureApi<ProbeApiMap>();
const otherInstance = createFeatureApi<ProbeApiMap>();

describe("feature tRPC bindings", () => {
  describe("given two independent createTRPCReact instances over one router shape", () => {
    it("derives identical query keys for the same procedure and input", () => {
      const input = { projectId: "project_1", traceId: "trace_1" };

      expect(getQueryKey(probeApi.tracesV2.header, input, "query")).toEqual(
        getQueryKey(otherInstance.tracesV2.header, input, "query"),
      );
    });

    it("derives identical procedure-wide keys", () => {
      expect(getQueryKey(probeApi.tracesV2.list)).toEqual(
        getQueryKey(otherInstance.tracesV2.list),
      );
    });
  });

  describe("when invalidating a procedure the feature map does not declare", () => {
    it("builds the key tRPC itself would have built for the whole procedure", () => {
      expect(trpcQueryKey("tracesV2.list")).toEqual(getQueryKey(probeApi.tracesV2.list));
    });

    it("builds the key tRPC itself would have built for one input", () => {
      const input = { projectId: "project_1", traceId: "trace_1" };

      expect(trpcQueryKey("tracesV2.header", { input, type: "query" })).toEqual(
        getQueryKey(probeApi.tracesV2.header, input, "query"),
      );
    });

    it("nests the path so a procedure-wide key prefixes every keyed query under it", () => {
      const wide = trpcQueryKey("tracesV2.list") as readonly [readonly string[]];
      const narrow = trpcQueryKey("tracesV2.list", {
        input: { projectId: "project_1" },
        type: "query",
      }) as readonly [readonly string[], unknown];

      expect(wide[0]).toEqual(["tracesV2", "list"]);
      expect(narrow[0]).toEqual(wide[0]);
    });

    it("wraps the key as a React Query filter", () => {
      expect(trpcQueryFilter("tracesV2.list")).toEqual({
        queryKey: trpcQueryKey("tracesV2.list"),
      });
    });
  });
});

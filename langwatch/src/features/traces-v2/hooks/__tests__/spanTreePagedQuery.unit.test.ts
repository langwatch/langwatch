import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";

import {
  fetchSpanTreePages,
  mergeSpanTreeDelta,
  SPAN_TREE_PAGE_SIZE,
  spanTreeDeltaSinceMs,
  spanTreeQueryFn,
  spanTreeQueryKey,
} from "../spanTreePagedQuery";

vi.mock("~/utils/api", () => ({
  api: {
    tracesV2: {
      // `getQueryKey` resolves the procedure path via the proxy's `_def()`.
      spanTree: { _def: () => ({ path: ["tracesV2", "spanTree"] }) },
    },
  },
}));

const node = (spanId: string, startTimeMs = 0): SpanTreeNode => ({
  spanId,
  parentSpanId: null,
  name: spanId,
  type: null,
  startTimeMs,
  endTimeMs: startTimeMs + 1,
  durationMs: 1,
  status: "ok",
  model: null,
});

type Page = {
  nodes: SpanTreeNode[];
  nextCursor: { startTimeMs: number; spanId: string } | null;
};

const input = { projectId: "p1", traceId: "t1" };

function makeUtils(pages: Page[]) {
  // `fetchSpanTreePages` wraps `utils.client` (the old-style string-path
  // TRPCClient) in `createTRPCClientProxy`, which forwards
  // `….tracesV2.spanTreePaginated.query(input, opts)` to
  // `client.query("tracesV2.spanTreePaginated", input, opts)`.
  const query = vi.fn();
  for (const page of pages) query.mockResolvedValueOnce(page);
  const utils = {
    client: { query },
  } as unknown as Parameters<typeof fetchSpanTreePages>[0]["utils"];
  return { utils, query };
}

const PAGED_PATH = "tracesV2.spanTreePaginated";

describe("fetchSpanTreePages", () => {
  describe("when the trace fits in a single page", () => {
    it("returns that page's nodes from one fetch and never reports progress", async () => {
      const { utils, query } = makeUtils([
        { nodes: [node("a"), node("b")], nextCursor: null },
      ]);
      const onPage = vi.fn();

      const nodes = await fetchSpanTreePages({ utils, input, onPage });

      expect(nodes.map((n) => n.spanId)).toEqual(["a", "b"]);
      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith(
        PAGED_PATH,
        { ...input, limit: SPAN_TREE_PAGE_SIZE, cursor: undefined },
        { signal: undefined },
      );
      expect(onPage).not.toHaveBeenCalled();
    });
  });

  describe("when the trace spans multiple pages", () => {
    it("threads each page's nextCursor into the following fetch and concatenates in order", async () => {
      const { utils, query } = makeUtils([
        {
          nodes: [node("a", 1), node("b", 2)],
          nextCursor: { startTimeMs: 2, spanId: "b" },
        },
        {
          nodes: [node("c", 3)],
          nextCursor: { startTimeMs: 3, spanId: "c" },
        },
        { nodes: [], nextCursor: null },
      ]);

      const nodes = await fetchSpanTreePages({ utils, input });

      expect(nodes.map((n) => n.spanId)).toEqual(["a", "b", "c"]);
      expect(query).toHaveBeenNthCalledWith(
        2,
        PAGED_PATH,
        {
          ...input,
          limit: SPAN_TREE_PAGE_SIZE,
          cursor: { startTimeMs: 2, spanId: "b" },
        },
        { signal: undefined },
      );
      expect(query).toHaveBeenCalledTimes(3);
    });

    it("reports cumulative progress after every non-final page", async () => {
      const { utils } = makeUtils([
        {
          nodes: [node("a")],
          nextCursor: { startTimeMs: 0, spanId: "a" },
        },
        { nodes: [node("b")], nextCursor: null },
      ]);
      const onPage = vi.fn();

      await fetchSpanTreePages({ utils, input, onPage });

      expect(onPage).toHaveBeenCalledTimes(1);
      expect(
        onPage.mock.calls[0]![0].map((n: SpanTreeNode) => n.spanId),
      ).toEqual(["a"]);
    });

    it("forwards the abort signal to every page request", async () => {
      const controller = new AbortController();
      const { utils, query } = makeUtils([
        {
          nodes: [node("a")],
          nextCursor: { startTimeMs: 0, spanId: "a" },
        },
        { nodes: [node("b")], nextCursor: null },
      ]);

      await fetchSpanTreePages({ utils, input, signal: controller.signal });

      expect(query).toHaveBeenNthCalledWith(1, PAGED_PATH, expect.anything(), {
        signal: controller.signal,
      });
      expect(query).toHaveBeenNthCalledWith(2, PAGED_PATH, expect.anything(), {
        signal: controller.signal,
      });
    });

    it("keeps a single row, re-sorted to its corrected position, for a span that reappears on a later page", async () => {
      const { utils } = makeUtils([
        {
          nodes: [node("a", 1), node("b", 2)],
          nextCursor: { startTimeMs: 2, spanId: "b" },
        },
        // Span "a" re-emitted with a corrected start time lands on page 2.
        { nodes: [node("a", 3)], nextCursor: null },
      ]);

      const nodes = await fetchSpanTreePages({ utils, input });

      expect(nodes.map((n) => n.spanId)).toEqual(["b", "a"]);
      expect(nodes.find((n) => n.spanId === "a")?.startTimeMs).toBe(3);
    });
  });

  describe("when the request is aborted between pages", () => {
    it("throws an AbortError instead of fetching the next page", async () => {
      const controller = new AbortController();
      const { utils, query } = makeUtils([]);
      query.mockImplementationOnce(async () => {
        controller.abort();
        return {
          nodes: [node("a")],
          nextCursor: { startTimeMs: 0, spanId: "a" },
        };
      });

      await expect(
        fetchSpanTreePages({ utils, input, signal: controller.signal }),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(query).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the request is aborted while the final page's fetch is pending", () => {
    it("throws an AbortError instead of returning the stale final page", async () => {
      const controller = new AbortController();
      const { utils, query } = makeUtils([]);
      query.mockImplementationOnce(async () => {
        controller.abort();
        return { nodes: [node("a")], nextCursor: null };
      });

      await expect(
        fetchSpanTreePages({ utils, input, signal: controller.signal }),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(query).toHaveBeenCalledTimes(1);
    });
  });
});

describe("spanTreeQueryFn progressive publishing", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
  });

  describe("when the cache entry is empty (first load)", () => {
    it("publishes each partial page so the waterfall paints early", async () => {
      const { utils } = makeUtils([
        {
          nodes: [node("a")],
          nextCursor: { startTimeMs: 0, spanId: "a" },
        },
        { nodes: [node("b")], nextCursor: null },
      ]);

      const queryFn = spanTreeQueryFn({ utils, queryClient, input });
      const result = await queryFn({});

      expect(result.map((n) => n.spanId)).toEqual(["a", "b"]);
      const published = queryClient.getQueryData<SpanTreeNode[]>(
        spanTreeQueryKey(input),
      );
      expect(published?.map((n) => n.spanId)).toEqual(["a"]);
    });

    it("grows the published partial with every page instead of freezing at page one", async () => {
      const published: string[][] = [];
      const { utils } = makeUtils([
        {
          nodes: [node("a")],
          nextCursor: { startTimeMs: 0, spanId: "a" },
        },
        {
          nodes: [node("b")],
          nextCursor: { startTimeMs: 0, spanId: "b" },
        },
        { nodes: [node("c")], nextCursor: null },
      ]);
      const originalSet = queryClient.setQueryData.bind(queryClient);
      vi.spyOn(queryClient, "setQueryData").mockImplementation(
        (key, data) => {
          published.push((data as SpanTreeNode[]).map((n) => n.spanId));
          return originalSet(key, data);
        },
      );

      const queryFn = spanTreeQueryFn({ utils, queryClient, input });
      await queryFn({});

      expect(published).toEqual([["a"], ["a", "b"]]);
    });
  });

  describe("when the cache already holds a full tree (refetch)", () => {
    it("does not shrink the cached tree with smaller partials", async () => {
      const fullTree = [node("a"), node("b"), node("c")];
      queryClient.setQueryData(spanTreeQueryKey(input), fullTree);
      const { utils } = makeUtils([
        {
          nodes: [node("a")],
          nextCursor: { startTimeMs: 0, spanId: "a" },
        },
        { nodes: [node("b")], nextCursor: null },
      ]);

      const queryFn = spanTreeQueryFn({ utils, queryClient, input });
      await queryFn({});

      const cached = queryClient.getQueryData<SpanTreeNode[]>(
        spanTreeQueryKey(input),
      );
      expect(cached).toBe(fullTree);
    });
  });
});

describe("spanTreeDeltaSinceMs", () => {
  describe("when the tree has spans", () => {
    it("returns 1ms before the newest span start so same-millisecond arrivals are re-fetched", () => {
      expect(
        spanTreeDeltaSinceMs([node("a", 100), node("b", 300), node("c", 200)]),
      ).toBe(299);
    });
  });

  describe("when the tree is empty", () => {
    it("returns 0 so a live trace picks up its first spans", () => {
      expect(spanTreeDeltaSinceMs([])).toBe(0);
    });
  });
});

describe("mergeSpanTreeDelta", () => {
  describe("when the delta only re-returns boundary rows already in the tree", () => {
    it("returns the same array reference so quiet polls cause no re-render", () => {
      const existing = [node("a", 1), node("b", 2)];

      expect(mergeSpanTreeDelta(existing, [node("b", 2)])).toBe(existing);
      expect(mergeSpanTreeDelta(existing, [])).toBe(existing);
    });
  });

  describe("when the delta carries new spans", () => {
    it("appends them in (startTimeMs, spanId) order", () => {
      const existing = [node("a", 1), node("c", 3)];

      const merged = mergeSpanTreeDelta(existing, [
        node("d", 2),
        node("b", 3),
      ]);

      expect(merged.map((n) => n.spanId)).toEqual(["a", "d", "b", "c"]);
    });
  });

  describe("when the delta carries a newer version of an existing span", () => {
    it("replaces the stale node instead of duplicating it", () => {
      const existing = [node("a", 1), node("b", 2)];
      const updated = { ...node("b", 2), durationMs: 42 };

      const merged = mergeSpanTreeDelta(existing, [updated]);

      expect(merged.map((n) => n.spanId)).toEqual(["a", "b"]);
      expect(merged.find((n) => n.spanId === "b")?.durationMs).toBe(42);
      expect(merged).not.toBe(existing);
    });
  });
});

import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";

import {
  fetchSpanTreePages,
  SPAN_TREE_PAGE_SIZE,
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
  const fetch = vi.fn();
  for (const page of pages) fetch.mockResolvedValueOnce(page);
  const utils = {
    tracesV2: { spanTreePaginated: { fetch } },
  } as unknown as Parameters<typeof fetchSpanTreePages>[0]["utils"];
  return { utils, fetch };
}

describe("fetchSpanTreePages", () => {
  describe("when the trace fits in a single page", () => {
    it("returns that page's nodes from one fetch and never reports progress", async () => {
      const { utils, fetch } = makeUtils([
        { nodes: [node("a"), node("b")], nextCursor: null },
      ]);
      const onPage = vi.fn();

      const nodes = await fetchSpanTreePages({ utils, input, onPage });

      expect(nodes.map((n) => n.spanId)).toEqual(["a", "b"]);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith(
        { ...input, limit: SPAN_TREE_PAGE_SIZE, cursor: undefined },
        expect.anything(),
      );
      expect(onPage).not.toHaveBeenCalled();
    });
  });

  describe("when the trace spans multiple pages", () => {
    it("threads each page's nextCursor into the following fetch and concatenates in order", async () => {
      const { utils, fetch } = makeUtils([
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
      expect(fetch).toHaveBeenNthCalledWith(
        2,
        {
          ...input,
          limit: SPAN_TREE_PAGE_SIZE,
          cursor: { startTimeMs: 2, spanId: "b" },
        },
        expect.anything(),
      );
      expect(fetch).toHaveBeenCalledTimes(3);
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
  });

  describe("when the request is aborted between pages", () => {
    it("throws an AbortError instead of fetching the next page", async () => {
      const controller = new AbortController();
      const { utils, fetch } = makeUtils([]);
      fetch.mockImplementationOnce(async () => {
        controller.abort();
        return {
          nodes: [node("a")],
          nextCursor: { startTimeMs: 0, spanId: "a" },
        };
      });

      await expect(
        fetchSpanTreePages({ utils, input, signal: controller.signal }),
      ).rejects.toThrow(/aborted/i);
      expect(fetch).toHaveBeenCalledTimes(1);
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

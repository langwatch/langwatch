/** @vitest-environment jsdom */

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type FakePage = { ids: string[]; scrollId?: string; error?: boolean };
type PageCall = {
  input: { query?: string; scrollId?: string | null };
  opts: { enabled?: boolean };
};

// An in-memory trace list: pages keyed by `${query}:${scrollId}`.
const server = vi.hoisted(() => ({
  pages: {} as Record<string, FakePage>,
  requests: [] as string[],
}));

vi.mock("../annotation-api.ts", () => ({
  annotationApi: {
    useQueries: (build: (t: unknown) => PageCall[]) => {
      const t = {
        traces: {
          getAllForProject: (input: PageCall["input"], opts: PageCall["opts"]) => ({ input, opts }),
        },
      };
      return build(t).map(({ input, opts }) => {
        if (opts.enabled === false) return { isLoading: false, isError: false };
        const id = `${input.query}:${input.scrollId ?? "first"}`;
        server.requests.push(id);
        const page = server.pages[id];
        if (!page) return { isLoading: true, isError: false };
        if (page.error) return { isLoading: false, isError: true };
        return {
          isLoading: false,
          isError: false,
          data: { groups: [page.ids.map((trace_id) => ({ trace_id }))], scrollId: page.scrollId },
        };
      });
    },
  },
}));

const { useTraceIdsAcrossPages } = await import("../use-trace-ids-across-pages.ts");

const render = ({
  query,
  maxPages,
  enabled = true,
}: {
  query: string;
  maxPages: number;
  enabled?: boolean;
}) =>
  renderHook(
    (props: { query: string }) =>
      useTraceIdsAcrossPages({
        input: { projectId: "proj-1", startDate: 1, endDate: 2, query: props.query },
        enabled,
        maxPages,
      }),
    { initialProps: { query } },
  );

beforeEach(() => {
  server.pages = {};
  server.requests = [];
});

describe("useTraceIdsAcrossPages", () => {
  describe("given a result set spanning three pages", () => {
    beforeEach(() => {
      server.pages = {
        "a:first": { ids: ["t1", "t2"], scrollId: "s2" },
        "a:s2": { ids: ["t3"], scrollId: "s3" },
        "a:s3": { ids: ["t4"] },
      };
    });

    describe("when the hook walks the pages", () => {
      /** @scenario "The filtered annotations list walks trace pages at the cap" */
      it("returns every id once the last page has no scrollId", async () => {
        const { result } = render({ query: "a", maxPages: 10 });
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.traceIds).toEqual(["t1", "t2", "t3", "t4"]);
      });
    });

    describe("when maxPages is reached before the walk ends", () => {
      /** @scenario "The filtered annotations list walks trace pages at the cap" */
      it("stops paging and returns what it has", async () => {
        const { result } = render({ query: "a", maxPages: 2 });
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.traceIds).toEqual(["t1", "t2", "t3"]);
        expect(server.requests).not.toContain("a:s3");
      });
    });

    describe("when the walk is not enabled", () => {
      it("reads no page and returns no ids", () => {
        const { result } = render({ query: "a", maxPages: 10, enabled: false });
        expect(result.current).toEqual({ traceIds: [], isLoading: false, isError: false });
        expect(server.requests).toEqual([]);
      });
    });
  });

  describe("given a later page fails", () => {
    /** @scenario "A failed trace page never shows a partial annotations list" */
    it("reports the error and returns no ids", async () => {
      server.pages = {
        "a:first": { ids: ["t1"], scrollId: "s2" },
        "a:s2": { ids: [], error: true },
      };
      const { result } = render({ query: "a", maxPages: 10 });
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.traceIds).toEqual([]);
    });
  });

  describe("when the filter changes after paging", () => {
    it("restarts from the first page without the old cursors", async () => {
      server.pages = {
        "a:first": { ids: ["t1"], scrollId: "s2" },
        "a:s2": { ids: ["t2"] },
        "b:first": { ids: ["u1"] },
      };
      const { result, rerender } = render({ query: "a", maxPages: 10 });
      await waitFor(() => expect(result.current.traceIds).toEqual(["t1", "t2"]));
      rerender({ query: "b" });
      await waitFor(() => expect(result.current.traceIds).toEqual(["u1"]));
      expect(server.requests).not.toContain("b:s2");
    });
  });
});

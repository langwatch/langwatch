/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTraceIdsAcrossPages } from "../useTraceIdsAcrossPages";

type FakePage = { ids: string[]; scrollId?: string; error?: boolean };

// In-memory server: pages keyed by `${filter}:${scrollId}`.
const server = vi.hoisted(() => ({ pages: {} as Record<string, FakePage> }));
const requests = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock("~/utils/api", () => ({
  api: {
    useQueries: (
      build: (t: unknown) => unknown[],
    ): {
      data?: { groups: { trace_id: string }[][]; scrollId?: string };
      isLoading: boolean;
      isError: boolean;
    }[] => {
      const t = {
        traces: {
          getAllForProject: (input: {
            query?: string;
            scrollId?: string | null;
          }) => input,
        },
      };
      return (build(t) as { query?: string; scrollId?: string | null }[]).map(
        (input) => {
          const id = `${input.query}:${input.scrollId ?? "first"}`;
          requests.calls.push(id);
          const page = server.pages[id];
          if (!page) return { isLoading: true, isError: false };
          if (page.error) return { isLoading: false, isError: true };
          return {
            isLoading: false,
            isError: false,
            data: {
              groups: [page.ids.map((trace_id) => ({ trace_id }))],
              scrollId: page.scrollId,
            },
          };
        },
      );
    },
  },
}));

const render = ({ query, maxPages }: { query: string; maxPages: number }) =>
  renderHook(
    (props: { query: string }) =>
      useTraceIdsAcrossPages({
        input: { query: props.query } as never,
        queryOpts: {},
        maxPages,
      }),
    { initialProps: { query } },
  );

describe("useTraceIdsAcrossPages", () => {
  beforeEach(() => {
    server.pages = {};
    requests.calls = [];
  });

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
        expect(requests.calls).not.toContain("a:s3");
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
      await waitFor(() =>
        expect(result.current.traceIds).toEqual(["t1", "t2"]),
      );
      rerender({ query: "b" });
      await waitFor(() => expect(result.current.traceIds).toEqual(["u1"]));
      expect(requests.calls).not.toContain("b:s2");
    });
  });
});

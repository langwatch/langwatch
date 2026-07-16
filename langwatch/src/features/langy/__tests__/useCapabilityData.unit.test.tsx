/**
 * @vitest-environment jsdom
 *
 * The hydration seam's resolution rules: WHAT gets fetched for which shape of
 * knowledge (start-frame command, id-ref digest, sub-entity read, no hydrator)
 * and what the card is told while it happens. The tRPC utils are faked at the
 * module boundary; the hydrator registry underneath is the real one, so these
 * tests also pin the trace hydrators' own read paths (per-id headers, the
 * Explorer's list read for a query).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCapabilityData } from "../hooks/useCapabilityData";

const headerFetch = vi.fn();
const listFetch = vi.fn();

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      tracesV2: {
        header: { fetch: headerFetch },
        list: { fetch: listFetch },
      },
    }),
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj_1" } }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  headerFetch.mockReset();
  listFetch.mockReset();
});

describe("useCapabilityData", () => {
  describe("given nothing to hydrate from", () => {
    it("stays idle with no digest and no command", () => {
      const { result } = renderHook(() => useCapabilityData({}), { wrapper });
      expect(result.current.status).toBe("idle");
    });

    it("stays idle for a resource with no hydrator", () => {
      const { result } = renderHook(
        () =>
          useCapabilityData({
            digest: {
              resource: "evaluator",
              verb: "list",
              strategy: "id-ref",
              ids: ["eval_1"],
            },
          }),
        { wrapper },
      );
      expect(result.current.status).toBe("idle");
    });
  });

  describe("given only the start-frame command (progressive path)", () => {
    it("fetches rows from the query immediately, before any result exists", async () => {
      listFetch.mockResolvedValue({
        items: [
          {
            traceId: "trace_9",
            timestamp: 1750000000000,
            name: "run",
            traceName: "run",
            durationMs: 900,
            totalCost: 0.002,
            status: "ok",
            input: "what is up",
            output: "all good",
          },
        ],
        totalHits: 12,
      });

      const { result } = renderHook(
        () =>
          useCapabilityData({
            command: {
              resource: "trace",
              verb: "search",
              query: { q: "checkout", "start-date": "1750000000000" },
            },
          }),
        { wrapper },
      );

      await waitFor(() => expect(result.current.status).toBe("hydrated"));
      expect(result.current.rows[0]?.id).toBe("trace_9");
      expect(result.current.totalCount).toBe(12);
      expect(listFetch).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "proj_1",
          query: '"checkout"',
          timeRange: expect.objectContaining({ from: 1750000000000 }),
        }),
      );
    });
  });

  describe("given an id-ref digest (the settled result)", () => {
    it("fetches each referenced trace and keeps id order", async () => {
      headerFetch.mockImplementation(async ({ traceId }: { traceId: string }) => ({
        traceId,
        timestamp: 1750000000000,
        traceName: traceId,
        durationMs: 500,
        totalCost: 0.001,
        status: "ok",
        input: `question ${traceId}`,
        output: "ok",
      }));

      const { result } = renderHook(
        () =>
          useCapabilityData({
            digest: {
              resource: "trace",
              verb: "search",
              strategy: "id-ref",
              ids: ["trace_a", "trace_b"],
              counts: { returned: 2, total: 34 },
            },
          }),
        { wrapper },
      );

      await waitFor(() => expect(result.current.status).toBe("hydrated"));
      expect(result.current.rows.map((row) => row.id)).toEqual([
        "trace_a",
        "trace_b",
      ]);
      expect(result.current.totalCount).toBe(34);
      expect(result.current.loadedCount).toBe(2);
    });

    it("hydrates only the rows the card draws, not the whole reference", async () => {
      headerFetch.mockResolvedValue({
        traceId: "t",
        timestamp: 1,
        traceName: "t",
        durationMs: 1,
        totalCost: 0,
        status: "ok",
        input: "x",
        output: "y",
      });
      const ids = Array.from({ length: 25 }, (_, i) => `trace_${i}`);

      const { result } = renderHook(
        () =>
          useCapabilityData({
            digest: {
              resource: "trace",
              verb: "search",
              strategy: "id-ref",
              ids,
            },
            maxRows: 3,
          }),
        { wrapper },
      );

      await waitFor(() => expect(result.current.status).toBe("hydrated"));
      expect(headerFetch).toHaveBeenCalledTimes(3);
    });

    it("skips the traces the viewer can no longer read instead of failing", async () => {
      headerFetch
        .mockResolvedValueOnce({
          traceId: "trace_a",
          timestamp: 1,
          traceName: "trace_a",
          durationMs: 1,
          totalCost: 0,
          status: "ok",
          input: "x",
          output: "y",
        })
        .mockRejectedValueOnce(new Error("NOT_FOUND"));

      const { result } = renderHook(
        () =>
          useCapabilityData({
            digest: {
              resource: "trace",
              verb: "search",
              strategy: "id-ref",
              ids: ["trace_a", "trace_gone"],
              counts: { returned: 2, total: 2 },
            },
          }),
        { wrapper },
      );

      await waitFor(() => expect(result.current.status).toBe("hydrated"));
      expect(result.current.rows.map((row) => row.id)).toEqual(["trace_a"]);
    });
  });

  describe("given a sub-entity read (dataset records, prompt versions)", () => {
    it("stays idle — a record id must never be resolved as if it named a dataset", () => {
      const { result } = renderHook(
        () =>
          useCapabilityData({
            digest: {
              resource: "dataset",
              verb: "records",
              strategy: "id-ref",
              ids: ["record_1", "record_2"],
            },
          }),
        { wrapper },
      );
      expect(result.current.status).toBe("idle");
    });
  });

  describe("given a settled result that parsed but named nothing (reduced tier)", () => {
    it("does not silently re-run the query — fresh rows could contradict the answer", () => {
      const { result } = renderHook(
        () =>
          useCapabilityData({
            digest: {
              resource: "trace",
              verb: "search",
              strategy: "reduced",
              query: { q: "checkout" },
              counts: { returned: 0, total: 0 },
            },
          }),
        { wrapper },
      );
      expect(result.current.status).toBe("idle");
      expect(listFetch).not.toHaveBeenCalled();
    });
  });
});

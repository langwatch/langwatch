// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";

import { LIVE_REFETCH_MS } from "../../constants/freshness";
import { useSpanTree } from "../useSpanTree";

type TreeQueryOptions = {
  queryKey: unknown;
  queryFn: unknown;
  enabled: boolean;
  refetchInterval?: unknown;
};

type DeltaQueryCall = {
  input: { sinceStartTimeMs: number };
  options: {
    enabled: boolean;
    refetchInterval: unknown;
    onSuccess: (delta: SpanTreeNode[]) => void;
  };
};

const node = (spanId: string, startTimeMs: number): SpanTreeNode => ({
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

const capturedTreeOptions: TreeQueryOptions[] = [];
const capturedDeltaCalls: DeltaQueryCall[] = [];
const getQueryData = vi.fn();
const setQueryData = vi.fn();

let treeData: SpanTreeNode[] | undefined;
let treeIsPreviousData = false;
let sseConnectionState = "connected";
let traceQueryArgs = {
  isLive: true,
  isReady: true,
  queryArgs: { projectId: "p1", traceId: "t1" },
};

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: TreeQueryOptions) => {
    capturedTreeOptions.push(options);
    return {
      data: treeData,
      isLoading: false,
      isPreviousData: treeIsPreviousData,
    };
  },
  useQueryClient: () => ({ getQueryData, setQueryData }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({}),
    tracesV2: {
      spanTreeDelta: {
        useQuery: (
          input: DeltaQueryCall["input"],
          options: DeltaQueryCall["options"],
        ) => {
          capturedDeltaCalls.push({ input, options });
          return {};
        },
      },
    },
  },
}));

const QUERY_FN_MARKER = () => Promise.resolve([]);

vi.mock("../spanTreePagedQuery", () => ({
  spanTreeQueryKey: (input: unknown) => ["spanTree", input],
  spanTreeQueryFn: () => QUERY_FN_MARKER,
  spanTreeDeltaSinceMs: (nodes: SpanTreeNode[]) =>
    nodes.length === 0
      ? 0
      : Math.max(0, Math.max(...nodes.map((n) => n.startTimeMs)) - 1),
  mergeSpanTreeDelta: (existing: SpanTreeNode[], delta: SpanTreeNode[]) =>
    delta.length === 0 ? existing : [...existing, ...delta],
}));

vi.mock("../useTraceQueryArgs", () => ({
  useTraceQueryArgs: () => traceQueryArgs,
}));

vi.mock("../../stores/sseStatusStore", () => ({
  useSseStatusStore: (
    selector: (state: { sseConnectionState: string }) => boolean,
  ) => selector({ sseConnectionState }),
}));

const lastTreeOptions = (): TreeQueryOptions => {
  const options = capturedTreeOptions[capturedTreeOptions.length - 1];
  if (!options) throw new Error("no tree query options were captured");
  return options;
};

const lastDeltaCall = (): DeltaQueryCall => {
  const call = capturedDeltaCalls[capturedDeltaCalls.length - 1];
  if (!call) throw new Error("no delta query call was captured");
  return call;
};

describe("useSpanTree", () => {
  beforeEach(() => {
    capturedTreeOptions.length = 0;
    capturedDeltaCalls.length = 0;
    getQueryData.mockReset();
    setQueryData.mockReset();
    treeData = [node("a", 100)];
    treeIsPreviousData = false;
    sseConnectionState = "connected";
    traceQueryArgs = {
      isLive: true,
      isReady: true,
      queryArgs: { projectId: "p1", traceId: "t1" },
    };
  });

  describe("when the drawer trace is ready", () => {
    it("keys and fetches the shared paged span-tree entry without its own poll interval", () => {
      renderHook(() => useSpanTree());

      expect(lastTreeOptions().queryKey).toEqual([
        "spanTree",
        { projectId: "p1", traceId: "t1" },
      ]);
      expect(lastTreeOptions().queryFn).toBe(QUERY_FN_MARKER);
      expect(lastTreeOptions().enabled).toBe(true);
      expect(lastTreeOptions().refetchInterval).toBeUndefined();
    });
  });

  describe("when the traceId is a preview-mode synthetic (not ready)", () => {
    it("disables both the fetch and the delta poll", () => {
      traceQueryArgs = { ...traceQueryArgs, isReady: false };

      renderHook(() => useSpanTree());

      expect(lastTreeOptions().enabled).toBe(false);
      expect(lastDeltaCall().options.enabled).toBe(false);
    });
  });

  describe("when the trace is live and SSE is connected", () => {
    it("does not poll deltas — SSE invalidation keeps the tree fresh push-style", () => {
      renderHook(() => useSpanTree());

      expect(lastDeltaCall().options.enabled).toBe(false);
    });
  });

  describe("when the trace is live and SSE is disconnected", () => {
    beforeEach(() => {
      sseConnectionState = "disconnected";
    });

    it("polls spanTreeDelta from the loaded tree's high-water mark instead of re-walking every page", () => {
      treeData = [node("a", 100), node("b", 300)];

      renderHook(() => useSpanTree());

      expect(lastDeltaCall().options.enabled).toBe(true);
      expect(lastDeltaCall().options.refetchInterval).toBe(LIVE_REFETCH_MS);
      expect(lastDeltaCall().input).toMatchObject({
        projectId: "p1",
        traceId: "t1",
        sinceStartTimeMs: 299,
      });
    });

    it("waits for the tree to load before polling (no high-water mark yet)", () => {
      treeData = undefined;

      renderHook(() => useSpanTree());

      expect(lastDeltaCall().options.enabled).toBe(false);
    });

    it("does not poll from a previous trace's tree while keepPreviousData bridges a trace switch", () => {
      treeData = [node("a", 100)];
      treeIsPreviousData = true;

      renderHook(() => useSpanTree());

      expect(lastDeltaCall().options.enabled).toBe(false);
    });

    it("merges delta spans into the shared cache entry", () => {
      const existing = [node("a", 100)];
      getQueryData.mockReturnValue(existing);

      renderHook(() => useSpanTree());
      lastDeltaCall().options.onSuccess([node("b", 200)]);

      expect(setQueryData).toHaveBeenCalledWith(
        ["spanTree", { projectId: "p1", traceId: "t1" }],
        [node("a", 100), node("b", 200)],
      );
    });

    it("leaves the cache untouched when the delta carries nothing new", () => {
      const existing = [node("a", 100)];
      getQueryData.mockReturnValue(existing);

      renderHook(() => useSpanTree());
      lastDeltaCall().options.onSuccess([]);

      expect(setQueryData).not.toHaveBeenCalled();
    });
  });

  describe("when the trace is no longer live", () => {
    it("does not poll deltas even with SSE disconnected", () => {
      traceQueryArgs = { ...traceQueryArgs, isLive: false };
      sseConnectionState = "disconnected";

      renderHook(() => useSpanTree());

      expect(lastDeltaCall().options.enabled).toBe(false);
    });
  });
});

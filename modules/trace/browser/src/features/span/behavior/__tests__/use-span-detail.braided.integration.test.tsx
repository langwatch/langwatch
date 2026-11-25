// @vitest-environment jsdom
/**
 * A braided span's detail is read from its owner however late the span panel mounts.
 * @see modules/trace/specs/braided-spans.feature
 */
import type { SpanTreeNode } from "@langwatch/trace-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openTraceDrawerAt } from "../../../../__tests__/window-location-router.ts";
import { useDrawerChrome } from "../../../../behavior/drawer-chrome.store.ts";
import { useTraceQueryArgs } from "../../../../behavior/explorer/use-trace-query-args.ts";
import { getTraceDrawer } from "../../../../behavior/trace-drawer.ts";
import { spanTreeQueryKey } from "../span-tree-paged-query.ts";
import { usePrefetchSpanDetail } from "../use-prefetch-span-detail.ts";
import { useSpanDetailCanonical } from "../use-span-detail.ts";

const reads = vi.hoisted(() => ({
  detail: [] as Record<string, unknown>[],
  prefetch: [] as Record<string, unknown>[],
}));

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import("../../../../__tests__/window-location-router.ts")).windowLocationRouter,
}));

vi.mock("../../../../behavior/trace-api.ts", () => ({
  api: {
    useUtils: () => ({
      traces: {
        spanDetail: {
          prefetch: (input: Record<string, unknown>) => {
            reads.prefetch.push(input);
            return Promise.resolve();
          },
        },
      },
    }),
    traces: {
      spanDetail: {
        useQuery: (input: Record<string, unknown>, options: { enabled: boolean }) => {
          if (options.enabled) reads.detail.push(input);
          return { data: undefined };
        },
      },
    },
  },
}));

// Both paths derive the tree's key from this one function; the tRPC proxy it wraps is mocked away.
vi.mock("../span-tree-paged-query.ts", () => ({
  spanTreeQueryKey: (input: unknown) => [["traces", "spanTree"], { input, type: "query" }],
}));

vi.mock("../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "checkout-web" } }),
}));

const TRACE_ID = "ca75c98c070e44a58131d962bf403345";
const BRAIDED_SPAN_ID = "274fa37c3e6fcb8b";
const OCCURRED_AT_MS = 1_792_629_841_607;

function span(over: Partial<SpanTreeNode> & { spanId: string }): SpanTreeNode {
  return {
    parentSpanId: null,
    name: over.spanId,
    type: "span",
    startTimeMs: OCCURRED_AT_MS,
    endTimeMs: OCCURRED_AT_MS + 1,
    durationMs: 1,
    status: "ok",
    model: null,
    ...over,
  };
}

const TREE: SpanTreeNode[] = [
  span({ spanId: "a705d19c432d0fc7", name: "POST /checkout" }),
  span({
    spanId: BRAIDED_SPAN_ID,
    parentSpanId: "a705d19c432d0fc7",
    name: "decide charge",
    ownerProjectId: "payments-agent",
  }),
];

let queryClient: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

/** The waterfall: mounted when the drawer opens, it loads the tree and prefetches on hover. */
function mountWaterfall() {
  return renderHook(() => ({ args: useTraceQueryArgs(), prefetch: usePrefetchSpanDetail() }), {
    wrapper,
  });
}

beforeEach(() => {
  queryClient = new QueryClient();
  reads.detail.length = 0;
  reads.prefetch.length = 0;
  useDrawerChrome.setState(useDrawerChrome.getInitialState(), true);
});

afterEach(cleanup);

describe("given a trace opened from a link with no time, holding a braided span", () => {
  describe("when the trace fills its time in and the reader then selects the braided span", () => {
    let waterfall: ReturnType<typeof mountWaterfall>;

    beforeEach(() => {
      openTraceDrawerAt({ traceId: TRACE_ID });
      waterfall = mountWaterfall();
      act(() => {
        queryClient.setQueryData(spanTreeQueryKey(waterfall.result.current.args.queryArgs), TREE);
      });
      act(() => getTraceDrawer().backfillOccurredAtMs(OCCURRED_AT_MS));
    });

    /** @scenario "A braided span selected in the tree opens from its owner" */
    it("reads the span from its owner", () => {
      act(() => getTraceDrawer().selectSpan(BRAIDED_SPAN_ID));
      renderHook(() => useSpanDetailCanonical(), { wrapper });

      expect(reads.detail.at(-1)).toMatchObject({
        projectId: "checkout-web",
        traceId: TRACE_ID,
        spanId: BRAIDED_SPAN_ID,
        ownerProjectId: "payments-agent",
      });
    });

    /** @scenario "A braided span selected in the tree opens from its owner" */
    it("reads it exactly as the hover before the click read it", () => {
      waterfall.result.current.prefetch(BRAIDED_SPAN_ID);
      act(() => getTraceDrawer().selectSpan(BRAIDED_SPAN_ID));
      renderHook(() => useSpanDetailCanonical(), { wrapper });

      expect(reads.prefetch.at(-1)).toMatchObject({ ownerProjectId: "payments-agent" });
      expect(reads.detail.at(-1)).toEqual(reads.prefetch.at(-1));
    });
  });

  describe("when the braided span was selected before the trace's spans loaded", () => {
    /** @scenario "A braided span selected in the tree opens from its owner" */
    it("reads the span from its owner once the spans arrive", async () => {
      openTraceDrawerAt({ traceId: TRACE_ID, span: BRAIDED_SPAN_ID });
      const waterfall = mountWaterfall();
      renderHook(() => useSpanDetailCanonical(), { wrapper });
      expect(reads.detail.at(-1)).not.toHaveProperty("ownerProjectId");

      act(() => {
        queryClient.setQueryData(spanTreeQueryKey(waterfall.result.current.args.queryArgs), TREE);
      });

      // React Query tells its observers on the next tick.
      await waitFor(() =>
        expect(reads.detail.at(-1)).toMatchObject({
          spanId: BRAIDED_SPAN_ID,
          ownerProjectId: "payments-agent",
        }),
      );
    });
  });
});

/**
 * @vitest-environment jsdom
 *
 * ADR-144 block F: opening a member's trace from an aggregate's list seeds and
 * prefetches the cache entries the drawer actually reads. The header seed is
 * what paints the drawer from the row before any read lands; keyed without
 * the member it sat in an entry the drawer never reads, and the drawer showed
 * a skeleton while four prefetches walked the span tree for nothing.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDrawerStore } from "../../stores/drawerStore";
import type { TraceListItem } from "../../types/trace";
import { useOpenTraceDrawer } from "../useOpenTraceDrawer";
import { useTraceQueryArgs } from "../useTraceQueryArgs";

const { utils, openDrawerMock, page } = vi.hoisted(() => {
  const procedure = () => ({ setData: vi.fn(), prefetch: vi.fn() });
  return {
    openDrawerMock: vi.fn(),
    page: { projectId: "project-aggregate" },
    utils: {
      tracesV2: {
        header: procedure(),
        spanTree: procedure(),
        spansFull: procedure(),
        spanDetail: procedure(),
        spanLangwatchSignals: procedure(),
        traceEvents: procedure(),
        resourceInfo: procedure(),
        evals: procedure(),
        conversationContext: procedure(),
      },
    },
  };
});

vi.mock("~/utils/api", () => ({ api: { useUtils: () => utils } }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ prefetchQuery: vi.fn() }),
}));
vi.mock("../spanTreePagedQuery", () => ({
  spanTreeQueryKey: (input: unknown) => ["spanTree", input],
  spanTreeQueryFn: () => vi.fn(),
}));
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: openDrawerMock }),
}));
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: page.projectId } }),
}));

const OCCURRED_AT = 1_700_000_000_000;

function rowOf(projectId: string): TraceListItem {
  return {
    traceId: "trace-twin",
    projectId,
    timestamp: OCCURRED_AT,
    name: "twin",
    serviceName: "svc",
    durationMs: 10,
    spanCount: 2,
    status: "ok",
    totalCost: 0,
    totalTokens: 0,
    models: [],
    evaluations: [],
    events: [],
  } as unknown as TraceListItem;
}

beforeEach(() => {
  vi.clearAllMocks();
  useDrawerStore.getState().closeDrawer();
});

describe("given an aggregate's list row for a member's trace", () => {
  describe("when the row opens the drawer", () => {
    it("seeds the header under the key the drawer reads, member included", () => {
      page.projectId = "project-aggregate";
      const open = renderHook(() => useOpenTraceDrawer()).result.current;

      act(() => open(rowOf("project-member")));
      const { queryArgs } = renderHook(() => useTraceQueryArgs()).result
        .current;

      expect(queryArgs).toMatchObject({ tenantId: "project-member" });
      expect(utils.tracesV2.header.setData).toHaveBeenCalledWith(
        { ...queryArgs, full: true },
        expect.any(Function),
      );
      expect(utils.tracesV2.resourceInfo.prefetch).toHaveBeenCalledWith(
        queryArgs,
        expect.anything(),
      );
    });
  });
});

describe("given a plain project's list row", () => {
  describe("when the row opens the drawer", () => {
    it("names no member, so every key stays as it was", () => {
      page.projectId = "project-plain";
      const open = renderHook(() => useOpenTraceDrawer()).result.current;

      act(() => open(rowOf("project-plain")));
      const { queryArgs } = renderHook(() => useTraceQueryArgs()).result
        .current;

      expect(queryArgs).toEqual({
        projectId: "project-plain",
        traceId: "trace-twin",
        occurredAtMs: OCCURRED_AT,
      });
      expect(utils.tracesV2.header.setData).toHaveBeenCalledWith(
        { ...queryArgs, full: true },
        expect.any(Function),
      );
    });
  });
});

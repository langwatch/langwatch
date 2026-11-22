/**
 * Opening a member's trace from an aggregate's list prefetches the cache entries the
 * drawer actually reads (ADR-177 block F): keyed without the member they would sit
 * where the drawer never looks.
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setWindowAddress } from "../../../../__tests__/window-location-router.ts";
import { NO_TRACE_EVENTS, type TraceListItem } from "../../../../behavior/explorer/types/trace.ts";

const seen = vi.hoisted(() => ({
  opened: undefined as Record<string, string> | undefined,
  headerPrefetch: vi.fn(),
  resourceInfoPrefetch: vi.fn(),
  projectId: "project-aggregate",
}));

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import("../../../../__tests__/window-location-router.ts")).windowLocationRouter,
}));

vi.mock("../../../../behavior/trace-api.ts", () => {
  const procedure = () => ({ setData: vi.fn(), prefetch: vi.fn() });
  const traces = {
    header: { setData: vi.fn(), prefetch: seen.headerPrefetch },
    resourceInfo: { setData: vi.fn(), prefetch: seen.resourceInfoPrefetch },
    spanLangwatchSignals: procedure(),
    traceEvents: procedure(),
  };
  return { api: { useUtils: () => ({ traces }) } };
});

vi.mock("@langwatch/browser-host/drawer", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useDrawer: () => ({
    openDrawer: (_name: string, params: Record<string, string>) => {
      seen.opened = params;
    },
  }),
}));

vi.mock("../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: seen.projectId } }),
}));

vi.mock("../../../span/behavior/span-tree-paged-query.ts", () => ({
  spanTreeQueryKey: (input: unknown) => ["spanTree", input],
  spanTreeQueryFn: () => () => undefined,
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useQueryClient: () => ({ prefetchQuery: vi.fn() }),
}));

const { useOpenTraceDrawer } = await import("../use-open-trace-drawer.ts");
const { useTraceQueryArgs } = await import("../../../../behavior/explorer/use-trace-query-args.ts");

const OCCURRED_AT = 1_700_000_000_000;

const rowOf = (projectId: string): TraceListItem => ({
  traceId: "trace-twin",
  projectId,
  timestamp: OCCURRED_AT,
  name: "twin",
  serviceName: "svc",
  durationMs: 10,
  totalCost: 0,
  nonBilledCost: 0,
  totalTokens: 0,
  models: [],
  labels: [],
  status: "ok",
  spanCount: 2,
  sizeBytes: 0,
  input: null,
  output: null,
  origin: "application",
  evaluations: [],
  events: NO_TRACE_EVENTS,
});

/** Opens the row, then follows the link it wrote and reads the drawer's query args. */
function openAndRead(row: TraceListItem) {
  renderHook(() => useOpenTraceDrawer()).result.current(row);
  const query = new URLSearchParams({ "drawer.open": "traceV2Details" });
  for (const [key, value] of Object.entries(seen.opened ?? {})) query.set(`drawer.${key}`, value);
  setWindowAddress({ url: `/acme/traces?${query.toString()}` });
  return renderHook(() => useTraceQueryArgs()).result.current.queryArgs;
}

beforeEach(() => {
  vi.clearAllMocks();
  seen.opened = undefined;
});

describe("given an aggregate's list row for a member's trace", () => {
  describe("when the row opens the drawer", () => {
    it("prefetches under the keys the drawer reads, member included", () => {
      seen.projectId = "project-aggregate";

      const queryArgs = openAndRead(rowOf("project-member"));

      expect(queryArgs).toMatchObject({ tenantId: "project-member" });
      expect(seen.headerPrefetch).toHaveBeenCalledWith(
        { ...queryArgs, full: true },
        expect.anything(),
      );
      expect(seen.resourceInfoPrefetch).toHaveBeenCalledWith(queryArgs);
    });
  });
});

describe("given a plain project's list row", () => {
  describe("when the row opens the drawer", () => {
    it("names no member, so every key stays as it was", () => {
      seen.projectId = "project-plain";

      const queryArgs = openAndRead(rowOf("project-plain"));

      expect(queryArgs).toEqual({
        projectId: "project-plain",
        traceId: "trace-twin",
        occurredAtMs: OCCURRED_AT,
      });
      expect(seen.resourceInfoPrefetch).toHaveBeenCalledWith(queryArgs);
    });
  });
});

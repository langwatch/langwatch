// @vitest-environment jsdom
/**
 * The evaluations panel's read does not wait for the partition hint. It looks
 * up by trace id, so on a deep link with no `t` it runs at once, and the
 * header's later backfill of the hint must not re-key it into a second read.
 *
 * @see specs/traces-v2/trace-drawer-shell.feature
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let storeState: {
  traceId: string | null;
  occurredAtMs: number | null;
  tenantId: string | null;
};

const useQuery = vi.fn((_input: unknown, _options: unknown) => ({
  data: undefined,
  isLoading: true,
  isError: false,
}));

vi.mock("~/utils/api", () => ({
  api: {
    traces: {
      getEvaluations: {
        useQuery: (input: unknown, options: unknown) =>
          useQuery(input, options),
      },
    },
  },
}));
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "agg" } }),
}));
vi.mock("../../context/SharedTraceContext", () => ({
  useSharedTrace: () => null,
}));
vi.mock("../../context/TraceViewerContext", () => ({
  useTraceViewer: () => ({ traceId: null }),
}));
vi.mock("../../stores/drawerStore", () => ({
  useDrawerStore: (selector: (state: typeof storeState) => unknown) =>
    selector(storeState),
}));
vi.mock("../useDrawerProjectId", () => ({
  useDrawerProjectId: () => "agg",
}));

import { useTraceEvaluations } from "../useTraceEvaluations";

function lastCall(): { input: unknown; enabled: unknown } {
  const [input, options] = useQuery.mock.calls.at(-1) as [
    unknown,
    { enabled?: unknown },
  ];
  return { input, enabled: options.enabled };
}

describe("useTraceEvaluations", () => {
  beforeEach(() => {
    useQuery.mockClear();
    storeState = { traceId: "t1", occurredAtMs: null, tenantId: "member-a" };
  });

  describe("when the drawer opened from a deep link with no partition hint", () => {
    /** @scenario "The evaluations read does not wait for the partition hint" */
    it("runs the read at once, naming the trace and its member", () => {
      renderHook(() => useTraceEvaluations());

      expect(lastCall()).toEqual({
        input: { projectId: "agg", traceId: "t1", tenantId: "member-a" },
        enabled: true,
      });
    });
  });

  describe("when the header backfills the hint", () => {
    /** @scenario "The evaluations read does not wait for the partition hint" */
    it("keeps the same input, so the read is neither re-keyed nor refetched", () => {
      const { rerender } = renderHook(() => useTraceEvaluations());
      const before = lastCall().input;

      storeState = { ...storeState, occurredAtMs: 1714476000000 };
      rerender();

      expect(lastCall().input).toEqual(before);
    });
  });
});

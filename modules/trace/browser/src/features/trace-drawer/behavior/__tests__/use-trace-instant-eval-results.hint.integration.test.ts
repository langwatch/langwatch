// @vitest-environment jsdom
/**
 * The drawer's Instant Evals read: asked only with release_instant_eval_results on, over the
 * trace's own time window and for the member the drawer is on.
 * @see modules/trace/specs/trace-instant-eval-results.feature
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let isReleased: boolean;

const useQuery = vi.fn((_input: unknown, _options: unknown) => ({
  data: undefined,
  isLoading: false,
  isError: false,
}));
const useFeatureFlag = vi.fn((_token: unknown, _options: unknown) => ({
  enabled: isReleased,
  isLoading: false,
}));

vi.mock("@langwatch/feature-flag-client", () => ({
  useFeatureFlag: (token: unknown, options: unknown) => useFeatureFlag(token, options),
}));
vi.mock("../../../../behavior/trace-api.ts", () => ({
  api: {
    traces: {
      instantEvalResults: {
        useQuery: (input: unknown, options: unknown) => useQuery(input, options),
      },
    },
  },
}));
vi.mock("../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "agg" }, organization: { id: "org-1" } }),
}));
vi.mock("../../../../behavior/explorer/context/trace-viewer-context.tsx", () => ({
  useTraceViewer: () => ({ traceId: null, isReadOnly: false }),
}));
vi.mock("../../../../behavior/trace-drawer.ts", () => ({
  useTraceDrawer: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      traceId: "t1",
      occurredAtMs: null,
      tenantId: "member-a",
      backfilledOccurredAt: null,
    }),
}));
vi.mock("../use-drawer-project-id.ts", () => ({
  useDrawerProjectId: () => "agg",
}));

import { useTraceInstantEvalResults } from "../use-trace-instant-eval-results.ts";

const TRACE = { traceId: "t1", timestamp: 1_714_476_000_000, durationMs: 4_000 };

function lastCall(): { input: unknown; enabled: unknown } {
  const [input, options] = useQuery.mock.calls.at(-1) as [unknown, { enabled?: unknown }];
  return { input, enabled: options.enabled };
}

describe("useTraceInstantEvalResults", () => {
  beforeEach(() => {
    useQuery.mockClear();
    useFeatureFlag.mockClear();
  });

  describe("given release_instant_eval_results off", () => {
    /** @scenario "The Instant Evals section reads only with release_instant_eval_results on" */
    it("never runs the read and hides the section", () => {
      isReleased = false;

      const { result } = renderHook(() => useTraceInstantEvalResults({ trace: TRACE }));

      expect(lastCall().enabled).toBe(false);
      expect(result.current.isShown).toBe(false);
    });
  });

  describe("given release_instant_eval_results on", () => {
    /** @scenario "The Instant Evals read keys on the trace's window and its member" */
    it("asks the flag for the member and reads over the trace's own window", () => {
      isReleased = true;

      const { result } = renderHook(() => useTraceInstantEvalResults({ trace: TRACE }));

      expect(useFeatureFlag.mock.calls.at(-1)?.[1]).toEqual({
        projectId: "member-a",
        organizationId: "org-1",
        enabled: true,
      });
      expect(lastCall()).toEqual({
        input: {
          projectId: "agg",
          traceId: "t1",
          occurredFrom: TRACE.timestamp,
          occurredUntil: TRACE.timestamp + TRACE.durationMs,
          tenantId: "member-a",
        },
        enabled: true,
      });
      expect(result.current.isShown).toBe(true);
    });

    /** @scenario "The Instant Evals read keys on the trace's window and its member" */
    it("waits while the header still belongs to the previous trace", () => {
      isReleased = true;

      renderHook(() => useTraceInstantEvalResults({ trace: { ...TRACE, traceId: "t0" } }));

      expect(lastCall().enabled).toBe(false);
    });
  });
});

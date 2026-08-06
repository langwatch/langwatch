/**
 * @vitest-environment jsdom
 *
 * `useTraceListEvents` merges each row's events in from their own read.
 * Events are not on the trace summary, so the list asks for them separately —
 * which makes when it asks, and what a row shows before the answer arrives,
 * part of the behaviour rather than an implementation detail.
 *
 * See specs/traces-v2/trace-list-events-column.feature.
 */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  useQuery: vi.fn(),
  projectId: { value: "proj-1" as string | undefined },
  view: { columnOrder: ["time", "trace", "events"], grouping: "flat" },
}));

vi.mock("~/utils/api", () => ({
  api: { tracesV2: { listEvents: { useQuery: harness.useQuery } } },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: harness.projectId.value
      ? { id: harness.projectId.value }
      : undefined,
  }),
}));

vi.mock("../../stores/filterStore", () => ({
  useFilterStore: (selector: (s: unknown) => unknown) =>
    selector({ debouncedTimeRange: { from: 1_000, to: 2_000 } }),
}));

vi.mock("../../stores/viewStore", () => ({
  useViewStore: (selector: (s: unknown) => unknown) => selector(harness.view),
}));

import type { TraceListItem } from "../../types/trace";
import { NO_TRACE_EVENTS } from "../../types/trace";
import { useTraceListEvents } from "../useTraceListEvents";

function row(traceId: string): TraceListItem {
  return {
    traceId,
    timestamp: 0,
    name: traceId,
    serviceName: "svc",
    durationMs: 1,
    totalCost: 0,
    totalTokens: 0,
    models: [],
    labels: [],
    status: "ok",
    spanCount: 1,
    evaluations: [],
    events: NO_TRACE_EVENTS,
  } as unknown as TraceListItem;
}

const lastInput = () => harness.useQuery.mock.calls.at(-1)?.[0];
const lastOpts = () => harness.useQuery.mock.calls.at(-1)?.[1];

function resolveWith({
  data,
  extra = {},
}: {
  data: unknown;
  extra?: Record<string, unknown>;
}) {
  harness.useQuery.mockImplementation(() => ({
    data,
    isLoading: false,
    ...extra,
  }));
}

beforeEach(() => {
  harness.useQuery.mockReset();
  resolveWith({ data: undefined });
  harness.projectId.value = "proj-1";
  harness.view = { columnOrder: ["time", "trace", "events"], grouping: "flat" };
});

describe("useTraceListEvents", () => {
  describe("given the Events column is visible", () => {
    describe("when a page of traces is on screen", () => {
      /** @scenario Events are shown for the traces currently on screen */
      it("asks once for the page's trace ids and the list's time range", () => {
        renderHook(() => useTraceListEvents({ rows: [row("t1"), row("t2")] }));

        expect(lastOpts()).toEqual(expect.objectContaining({ enabled: true }));
        expect(lastInput()).toEqual(
          expect.objectContaining({
            projectId: "proj-1",
            traceIds: ["t1", "t2"],
            timeRange: { from: 1_000, to: 2_000 },
          }),
        );
      });
    });

    describe("when the events have arrived", () => {
      /** @scenario The list agrees with the drawer */
      it("merges each trace's events onto its own row", () => {
        resolveWith({
          data: {
            t1: {
              names: [{ name: "thumbs_up_down", count: 1, firstTimestamp: 5 }],
              totalCount: 1,
              distinctCount: 1,
            },
          },
        });

        const { result } = renderHook(() =>
          useTraceListEvents({ rows: [row("t1"), row("t2")] }),
        );

        expect(result.current[0]?.events).toEqual({
          groups: [{ name: "thumbs_up_down", count: 1, firstTimestamp: 5 }],
          totalCount: 1,
          distinctCount: 1,
        });
        // A trace the read said nothing about recorded nothing.
        expect(result.current[1]?.events).toEqual(NO_TRACE_EVENTS);
      });
    });

    describe("when the events have not arrived yet", () => {
      /** @scenario The list still renders while events are in flight */
      it("marks rows pending, without claiming they are empty", () => {
        harness.useQuery.mockImplementation(() => ({
          data: undefined,
          isLoading: true,
        }));

        const { result } = renderHook(() =>
          useTraceListEvents({ rows: [row("t1")] }),
        );

        expect(result.current[0]?.eventsLoading).toBe(true);
        expect(result.current[0]?.events).toEqual(NO_TRACE_EVENTS);
      });
    });

    describe("when the page turns and the previous page's answers are still held", () => {
      /** @scenario Turning the page waits for that page's own events */
      it("keeps the new rows pending rather than reading them as empty", () => {
        // React Query hands back the old page's data with `isLoading` already
        // false, and none of it is keyed by a trace on the new page.
        resolveWith({
          data: {
            "old-page-trace": {
              names: [{ name: "tool.output", count: 1, firstTimestamp: 1 }],
              totalCount: 1,
              distinctCount: 1,
            },
          },
          extra: { isPreviousData: true },
        });

        const { result } = renderHook(() =>
          useTraceListEvents({ rows: [row("t9")] }),
        );

        expect(result.current[0]?.eventsLoading).toBe(true);
        expect(result.current[0]?.events).toEqual(NO_TRACE_EVENTS);
      });
    });

    describe("when the events could not be loaded", () => {
      /** @scenario A failed events read says so rather than reading as empty */
      it("marks the rows unavailable and leaves the rest of them intact", () => {
        harness.useQuery.mockImplementation(() => ({
          data: undefined,
          isLoading: false,
          isError: true,
        }));

        const rows = [row("t1"), row("t2")];
        const { result } = renderHook(() => useTraceListEvents({ rows }));

        expect(result.current).toHaveLength(2);
        expect(result.current[0]?.traceId).toBe("t1");
        expect(result.current[0]?.eventsUnavailable).toBe(true);
        expect(result.current[0]?.eventsLoading).toBeFalsy();
      });
    });
  });

  describe("given nothing on screen reads a row's events", () => {
    describe("when a page of traces is on screen", () => {
      /** @scenario Hiding the Events column costs nothing */
      it("makes no request", () => {
        harness.view = { columnOrder: ["time", "trace"], grouping: "flat" };

        renderHook(() => useTraceListEvents({ rows: [row("t1")] }));

        expect(lastOpts()).toEqual(expect.objectContaining({ enabled: false }));
      });
    });
  });

  describe("given the page has no traces on it", () => {
    describe("when the Events column is visible", () => {
      /** @scenario A page with no traces on it shows no events */
      it("makes no request", () => {
        renderHook(() => useTraceListEvents({ rows: [] }));

        expect(lastOpts()).toEqual(expect.objectContaining({ enabled: false }));
      });
    });
  });

  describe("given the rows are onboarding sample traces", () => {
    describe("when the Events column is visible", () => {
      /** @scenario Onboarding sample traces keep the events they ship with */
      it("looks nothing up and leaves the fixtures' own events alone", () => {
        const sample = row("sample-1");
        sample.events = {
          groups: [{ name: "thumbs_up_down", count: 1, firstTimestamp: 1 }],
          totalCount: 1,
          distinctCount: 1,
        };

        const { result } = renderHook(() =>
          useTraceListEvents({ rows: [sample], isSamplePreview: true }),
        );

        expect(lastOpts()).toEqual(expect.objectContaining({ enabled: false }));
        expect(result.current[0]?.events.groups).toEqual([
          { name: "thumbs_up_down", count: 1, firstTimestamp: 1 },
        ]);
      });
    });
  });

  describe("given the Events column was hidden", () => {
    describe("when the user enables it", () => {
      /** @scenario Enabling the Events column fills it in place */
      it("starts asking for the traces already on screen", () => {
        harness.view = { columnOrder: ["time", "trace"], grouping: "flat" };
        const rows = [row("t1")];
        const { rerender } = renderHook(() => useTraceListEvents({ rows }));
        expect(lastOpts()).toEqual(expect.objectContaining({ enabled: false }));

        harness.view = {
          columnOrder: ["time", "trace", "events"],
          grouping: "flat",
        };
        rerender();

        expect(lastOpts()).toEqual(expect.objectContaining({ enabled: true }));
        expect(lastInput()).toEqual(
          expect.objectContaining({ traceIds: ["t1"] }),
        );
      });
    });
  });

  describe("given the Conversations lens is active without the Events column", () => {
    describe("when a page of traces is on screen", () => {
      /** @scenario A group's event count sums its traces' events */
      it("still asks, because the group rows total their turns' events", () => {
        harness.view = {
          columnOrder: ["conversation", "turns"],
          grouping: "by-conversation",
        };

        renderHook(() => useTraceListEvents({ rows: [row("t1")] }));

        expect(lastOpts()).toEqual(expect.objectContaining({ enabled: true }));
      });
    });
  });
});

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

function resolveWith(data: unknown, extra: Record<string, unknown> = {}) {
  harness.useQuery.mockImplementation(() => ({
    data,
    isLoading: false,
    ...extra,
  }));
}

beforeEach(() => {
  harness.useQuery.mockReset();
  resolveWith(undefined);
  harness.projectId.value = "proj-1";
  harness.view = { columnOrder: ["time", "trace", "events"], grouping: "flat" };
});

describe("useTraceListEvents", () => {
  describe("given the Events column is visible", () => {
    /** @scenario Events are fetched for the traces currently on screen */
    it("asks once for the page's trace ids and the list's time range", () => {
      renderHook(() => useTraceListEvents([row("t1"), row("t2")]));

      expect(lastOpts()).toEqual(expect.objectContaining({ enabled: true }));
      expect(lastInput()).toEqual(
        expect.objectContaining({
          projectId: "proj-1",
          traceIds: ["t1", "t2"],
          timeRange: { from: 1_000, to: 2_000 },
        }),
      );
    });

    /** @scenario The list agrees with the drawer */
    it("merges each trace's events onto its own row", () => {
      resolveWith({
        t1: {
          names: [{ name: "thumbs_up_down", count: 1, firstTimestamp: 5 }],
          totalCount: 1,
          distinctCount: 1,
        },
      });

      const { result } = renderHook(() =>
        useTraceListEvents([row("t1"), row("t2")]),
      );

      expect(result.current[0]?.events).toEqual({
        groups: [{ name: "thumbs_up_down", count: 1, firstTimestamp: 5 }],
        totalCount: 1,
        distinctCount: 1,
      });
      // A trace the read said nothing about recorded nothing.
      expect(result.current[1]?.events).toEqual(NO_TRACE_EVENTS);
    });

    /** @scenario The list still renders while events are in flight */
    it("marks rows pending while the read is in flight, without claiming they are empty", () => {
      harness.useQuery.mockImplementation(() => ({
        data: undefined,
        isLoading: true,
      }));

      const { result } = renderHook(() => useTraceListEvents([row("t1")]));

      expect(result.current[0]?.eventsLoading).toBe(true);
      expect(result.current[0]?.events).toEqual(NO_TRACE_EVENTS);
    });

    /** @scenario A failed events read leaves the rest of the list intact */
    it("leaves the rows intact when the read fails", () => {
      harness.useQuery.mockImplementation(() => ({
        data: undefined,
        isLoading: false,
        isError: true,
      }));

      const rows = [row("t1"), row("t2")];
      const { result } = renderHook(() => useTraceListEvents(rows));

      expect(result.current).toHaveLength(2);
      expect(result.current[0]?.traceId).toBe("t1");
      // No events to show and nothing pending, so the column falls back to
      // its empty marker rather than the list falling over.
      expect(result.current[0]?.events).toEqual(NO_TRACE_EVENTS);
      expect(result.current[0]?.eventsLoading).toBeFalsy();
    });
  });

  describe("given nothing on screen reads a row's events", () => {
    /** @scenario Hiding the Events column stops the fetch */
    it("makes no request", () => {
      harness.view = { columnOrder: ["time", "trace"], grouping: "flat" };

      renderHook(() => useTraceListEvents([row("t1")]));

      expect(lastOpts()).toEqual(expect.objectContaining({ enabled: false }));
    });

    /** @scenario An empty page of trace ids skips the query entirely */
    it("makes no request for an empty page even with the column visible", () => {
      renderHook(() => useTraceListEvents([]));

      expect(lastOpts()).toEqual(expect.objectContaining({ enabled: false }));
    });
  });

  describe("when the user enables the Events column", () => {
    /** @scenario Enabling the Events column triggers the fetch */
    it("starts asking for the traces already on screen", () => {
      harness.view = { columnOrder: ["time", "trace"], grouping: "flat" };
      const rows = [row("t1")];
      const { rerender } = renderHook(() => useTraceListEvents(rows));
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

  describe("given the Conversations lens is active without the Events column", () => {
    /** @scenario A group's event count sums its traces' events */
    it("still asks, because the group rows total their turns' events", () => {
      harness.view = {
        columnOrder: ["conversation", "turns"],
        grouping: "by-conversation",
      };

      renderHook(() => useTraceListEvents([row("t1")]));

      expect(lastOpts()).toEqual(expect.objectContaining({ enabled: true }));
    });
  });
});

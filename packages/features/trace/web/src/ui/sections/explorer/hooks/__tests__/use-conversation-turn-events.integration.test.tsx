/**
 * @vitest-environment jsdom
 *
 * `useConversationTurnEvents` merges each turn's events in from their own
 * read. A turn arrives without them, so the thread asks for the whole set at
 * once and every turn carries only its own answer.
 *
 * See specs/traces-v2/conversation-turn-ledger.feature.
 */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  useQuery: vi.fn(),
  projectId: { value: "proj-1" as string | undefined },
  isReadOnly: { value: false },
}));

vi.mock("../../../trace-api", () => ({
  api: { tracesV2: { listEvents: { useQuery: harness.useQuery } } },
}));

vi.mock("../../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: harness.projectId.value ? { id: harness.projectId.value } : undefined,
  }),
}));

vi.mock("../../../../elements/explorer/context/trace-viewer-context", () => ({
  useIsReadOnlyTrace: () => harness.isReadOnly.value,
}));

import type { TraceListItem } from "../../types/trace";
import { NO_TRACE_EVENTS } from "../../types/trace";
import { useConversationTurnEvents } from "../use-conversation-turn-events";

/** A turn with no events of its own, so only what the hook merges in shows up. */
function turn(traceId: string, timestamp: number): TraceListItem {
  return {
    traceId,
    timestamp,
    name: traceId,
    serviceName: "svc",
    durationMs: 1_000,
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

const rollup = (name: string, count: number) => ({
  names: [{ name, count, firstTimestamp: 1 }],
  totalCount: count,
  distinctCount: 1,
});

/** What the hook asked for on its most recent render. */
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
  harness.isReadOnly.value = false;
});

describe("useConversationTurnEvents", () => {
  describe("given a thread whose turns recorded different events", () => {
    /** @scenario "Each turn in a thread carries the events it recorded" */
    it("gives every turn its own count", () => {
      resolveWith({
        data: { "t-1": rollup("tool.output", 3), "t-2": rollup("vote", 1) },
      });

      const { result } = renderHook(() =>
        useConversationTurnEvents([turn("t-1", 10), turn("t-2", 20)]),
      );

      expect(result.current.map((t) => t.events.totalCount)).toEqual([3, 1]);
      expect(result.current[0]!.events.groups).toEqual([
        { name: "tool.output", count: 3, firstTimestamp: 1 },
      ]);
    });

    it("asks once for every turn in the thread", () => {
      renderHook(() => useConversationTurnEvents([turn("t-2", 20), turn("t-1", 10)]));

      expect(lastInput()).toMatchObject({
        projectId: "proj-1",
        traceIds: ["t-1", "t-2"],
      });
    });

    it("reads over the span the turns themselves cover", () => {
      renderHook(() =>
        useConversationTurnEvents([turn("t-1", 10_000_000), turn("t-2", 20_000_000)]),
      );

      const { timeRange } = lastInput() as {
        timeRange: { from: number; to: number };
      };

      expect(timeRange.from).toBeLessThan(10_000_000);
      expect(timeRange.to).toBeGreaterThan(20_001_000);
    });
  });

  describe("given the events have not arrived yet", () => {
    /** @scenario "A turn still waiting on its events reports none" */
    it("leaves every turn reporting no events", () => {
      resolveWith({ data: undefined, extra: { isLoading: true } });

      const { result } = renderHook(() => useConversationTurnEvents([turn("t-1", 10)]));

      expect(result.current[0]!.events).toEqual(NO_TRACE_EVENTS);
      expect(result.current[0]!.eventsLoading).toBe(true);
    });
  });

  describe("given a turn belonging to a thread that just changed", () => {
    it("keeps reporting none until its own answer arrives", () => {
      resolveWith({
        data: { "old-turn": rollup("vote", 2) },
        extra: { isPlaceholderData: true },
      });

      const { result } = renderHook(() => useConversationTurnEvents([turn("t-1", 10)]));

      expect(result.current[0]!.events).toEqual(NO_TRACE_EVENTS);
      expect(result.current[0]!.eventsLoading).toBe(true);
    });
  });

  describe("given the read failed", () => {
    it("says the events are unavailable rather than claiming none", () => {
      resolveWith({ data: undefined, extra: { isError: true } });

      const { result } = renderHook(() => useConversationTurnEvents([turn("t-1", 10)]));

      expect(result.current[0]!.eventsUnavailable).toBe(true);
    });
  });

  describe("given the conversation is empty", () => {
    it("asks for nothing", () => {
      renderHook(() => useConversationTurnEvents([]));

      expect(lastOpts()?.enabled).toBe(false);
    });
  });

  describe("given a read-only viewer opened the trace through a share", () => {
    it("asks for nothing, since the read stays project protected", () => {
      harness.isReadOnly.value = true;

      renderHook(() => useConversationTurnEvents([turn("t-1", 10)]));

      expect(lastOpts()?.enabled).toBe(false);
    });
  });
});

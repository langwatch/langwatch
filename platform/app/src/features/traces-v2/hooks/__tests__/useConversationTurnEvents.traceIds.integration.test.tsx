/**
 * @vitest-environment jsdom
 *
 * Which ids the thread's one events read asks for. The turns are the source,
 * and the same trace appearing twice among them is still one id to read.
 */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ useQuery: vi.fn() }));

vi.mock("~/utils/api", () => ({
  api: { tracesV2: { listEvents: { useQuery: harness.useQuery } } },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1" } }),
}));

vi.mock("../../context/TraceViewerContext", () => ({
  useIsReadOnlyTrace: () => false,
}));

import type { TraceListItem } from "../../types/trace";
import { NO_TRACE_EVENTS } from "../../types/trace";
import { useConversationTurnEvents } from "../useConversationTurnEvents";

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

const lastInput = () => harness.useQuery.mock.calls.at(-1)?.[0];

beforeEach(() => {
  harness.useQuery.mockReset();
  harness.useQuery.mockImplementation(() => ({
    data: undefined,
    isLoading: false,
  }));
});

describe("useConversationTurnEvents", () => {
  describe("given the same trace appears more than once among the turns", () => {
    it("asks for that trace once", () => {
      renderHook(() =>
        useConversationTurnEvents([turn("t-2", 20), turn("t-1", 10), turn("t-1", 10)]),
      );

      expect(lastInput()).toMatchObject({ traceIds: ["t-1", "t-2"] });
    });
  });
});

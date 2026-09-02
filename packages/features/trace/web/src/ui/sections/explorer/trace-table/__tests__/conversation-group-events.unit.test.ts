import { describe, expect, it } from "vitest";
import type { TraceListItem } from "../../types/trace";
import { NO_TRACE_EVENTS } from "../../types/trace";
import { groupTracesByConversation } from "../conversation-groups";

/**
 * The Conversations lens totals its turns' events on the group row. It reads
 * the same rollups the Events column does, so it counts every event a turn
 * recorded — not how many distinct names those events collapsed into.
 */
function turn({
  traceId,
  events,
}: {
  traceId: string;
  events: TraceListItem["events"];
}): TraceListItem {
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
    conversationId: "conv-1",
    evaluations: [],
    events,
  } as unknown as TraceListItem;
}

describe("groupTracesByConversation", () => {
  describe("given a conversation whose turns recorded events", () => {
    describe("when grouping the conversation", () => {
      /** @scenario A group's event count sums its traces' events */
      it("totals every event across the turns, not the distinct names", () => {
        const groups = groupTracesByConversation([
          turn({
            traceId: "t1",
            events: {
              groups: [{ name: "tool.output", count: 2, firstTimestamp: 1 }],
              totalCount: 2,
              distinctCount: 1,
            },
          }),
          turn({
            traceId: "t2",
            events: {
              groups: [
                { name: "tool.output", count: 2, firstTimestamp: 2 },
                { name: "exception", count: 1, firstTimestamp: 3 },
              ],
              totalCount: 3,
              distinctCount: 2,
            },
          }),
        ]);

        expect(groups[0]?.totalEvents).toBe(5);
      });
    });
  });

  describe("given a conversation whose turns recorded no events", () => {
    describe("when grouping the conversation", () => {
      /** @scenario A conversation whose traces recorded no events shows no counter */
      it("totals zero, which the row renders as no counter at all", () => {
        const groups = groupTracesByConversation([
          turn({ traceId: "t1", events: NO_TRACE_EVENTS }),
          turn({ traceId: "t2", events: NO_TRACE_EVENTS }),
        ]);

        expect(groups[0]?.totalEvents).toBe(0);
      });
    });
  });
});

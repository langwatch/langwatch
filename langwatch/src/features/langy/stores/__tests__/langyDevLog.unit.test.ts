import { LANGY_CONVERSATION_EVENT_TYPES } from "@langwatch/langy";
import { beforeEach, describe, expect, it } from "vitest";

import {
  replayTurnProjection,
  tapeUpTo,
  tokenStreamText,
  useLangyDevLog,
} from "../langyDevLog";

/**
 * The inspector's tape: four lanes on one ring, recorded only while armed, and
 * a REPLAY of the durable lane through the shared reducers — the scrubber's
 * "fold at that moment" is exactly this function over a tape prefix.
 */

const turnAccepted = (id: string, createdAt: number) => ({
  id,
  createdAt,
  occurredAt: createdAt,
  type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
  data: { conversationId: "c1", turnId: "t1" },
});

const turnResponded = (id: string, createdAt: number) => ({
  id,
  createdAt,
  occurredAt: createdAt,
  type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
  data: {
    conversationId: "c1",
    turnId: "t1",
    messageId: "m1",
    role: "assistant" as const,
    parts: [],
    outcome: "completed" as const,
  },
});

describe("the inspector tape", () => {
  beforeEach(() => {
    useLangyDevLog.setState({
      recording: false,
      records: [],
      dropped: 0,
      nextSeq: 1,
    });
  });

  describe("when recording is not armed", () => {
    it("records nothing on any lane", () => {
      const log = useLangyDevLog.getState();
      log.record({ type: "delta", text: "hi" } as never, "t1");
      log.recordOutbound("send", "hi", {});
      log.recordDurableEvent(turnAccepted("e1", 100) as never);
      log.recordSignal({ conversationId: "c1", cursor: null });
      expect(useLangyDevLog.getState().records).toHaveLength(0);
    });
  });

  describe("when armed", () => {
    beforeEach(() => {
      useLangyDevLog.getState().setRecording(true);
    });

    it("interleaves all four lanes on one monotonic tape", () => {
      const log = useLangyDevLog.getState();
      log.recordOutbound("send", "why?", { text: "why?" });
      log.recordSignal({
        conversationId: "c1",
        cursor: { acceptedAt: 100, eventId: "e1" },
      });
      log.recordDurableEvent(turnAccepted("e1", 100) as never);
      log.record({ type: "delta", text: "because" } as never, "t1");

      const records = useLangyDevLog.getState().records;
      expect(records.map((r) => r.lane)).toEqual([
        "outbound",
        "signal",
        "durable",
        "stream",
      ]);
      expect(records.map((r) => r.seq)).toEqual([1, 2, 3, 4]);
    });

    it("stream helpers ignore the other lanes", () => {
      const log = useLangyDevLog.getState();
      log.recordOutbound("send", "why?", {});
      log.record({ type: "delta", text: "a" } as never, "t1");
      log.recordDurableEvent(turnResponded("e2", 200) as never);
      log.record({ type: "delta", text: "b" } as never, "t1");
      expect(tokenStreamText(useLangyDevLog.getState().records)).toBe("ab");
    });
  });

  describe("scrubbing", () => {
    it("tapeUpTo caps the tape at a seq; null means the whole tape", () => {
      useLangyDevLog.getState().setRecording(true);
      const log = useLangyDevLog.getState();
      log.recordOutbound("send", "1", {});
      log.recordOutbound("send", "2", {});
      log.recordOutbound("send", "3", {});
      const records = useLangyDevLog.getState().records;
      expect(tapeUpTo(records, 2).map((r) => r.seq)).toEqual([1, 2]);
      expect(tapeUpTo(records, null)).toHaveLength(3);
    });
  });

  describe("replaying the durable lane", () => {
    it("re-runs the shared fold over a tape prefix — time travel is a replay", () => {
      useLangyDevLog.getState().setRecording(true);
      const log = useLangyDevLog.getState();
      log.recordSnapshot({ cursor: null, currentTurnId: null });
      log.recordDurableEvent(turnAccepted("e1", 100) as never);
      log.record({ type: "delta", text: "…" } as never, "t1");
      log.recordDurableEvent(turnResponded("e2", 200) as never);

      const records = useLangyDevLog.getState().records;
      // Mid-turn: only the accept has landed.
      const midway = replayTurnProjection(tapeUpTo(records, 2));
      expect(midway.turn?.Status).toBe("running");
      // The full tape: the terminal folded in.
      const end = replayTurnProjection(records);
      expect(end.turn?.Status).toBe("completed");
      expect(end.cursor).toEqual({ acceptedAt: 200, eventId: "e2" });
    });
  });
});

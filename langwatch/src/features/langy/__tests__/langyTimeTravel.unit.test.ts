import { LANGY_CONVERSATION_EVENT_TYPES } from "@langwatch/langy";
import { describe, expect, it } from "vitest";

import type { LangyMessageDto } from "../data/langy.dtos";
import { buildTimeTravelView } from "../logic/langyTimeTravel";
import type { LangyDevLogRecord } from "../stores/langyDevLog";

/**
 * Time travel is a pure view: (tape prefix, durable history) → the
 * conversation as it stood at that moment. These pin the reconstruction rules
 * — settled answers come from the recorded event log deduped by messageId,
 * the live edge comes from the outbound + stream lanes, and LIVE (null scrub)
 * builds nothing at all.
 */

let seq = 0;
const rec = (partial: Omit<LangyDevLogRecord, "seq">): LangyDevLogRecord =>
  ({ ...partial, seq: ++seq }) as LangyDevLogRecord;

const send = (atMs: number, text: string) =>
  rec({
    atMs,
    lane: "outbound",
    kind: "send",
    label: text,
    detail: { text },
  } as never);

const delta = (atMs: number, turnId: string, text: string) =>
  rec({
    atMs,
    lane: "stream",
    turnId,
    entry: { type: "delta", text },
  } as never);

const status = (atMs: number, turnId: string, line: string) =>
  rec({
    atMs,
    lane: "stream",
    turnId,
    entry: { type: "status", status: line },
  } as never);

const accepted = (atMs: number, turnId: string, eventAt: number) =>
  rec({
    atMs,
    lane: "durable",
    source: "tail",
    event: {
      id: `evt-accept-${turnId}`,
      createdAt: eventAt,
      occurredAt: eventAt,
      type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
      data: { conversationId: "c1", turnId },
    },
  } as never);

const responded = (atMs: number, turnId: string, eventAt: number) =>
  rec({
    atMs,
    lane: "durable",
    source: "tail",
    event: {
      id: `evt-done-${turnId}`,
      createdAt: eventAt,
      occurredAt: eventAt,
      type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
      data: {
        conversationId: "c1",
        turnId,
        messageId: `msg-${turnId}`,
        role: "assistant",
        parts: [{ type: "text", text: "the full answer" }],
        outcome: "completed",
      },
    },
  } as never);

const historyRow = (
  id: string,
  role: "user" | "assistant",
  createdAtMs: number,
  text: string,
): LangyMessageDto => ({
  id,
  role,
  parts: [{ type: "text", text }],
  createdAtMs,
});

describe("buildTimeTravelView", () => {
  it("returns null on LIVE — nothing substitutes when the scrubber is home", () => {
    expect(
      buildTimeTravelView({ records: [], scrubSeq: null, historyMessages: [] }),
    ).toBeNull();
  });

  describe("scrubbed to mid-turn", () => {
    it("shows the sent question and the answer exactly as far as it had streamed", () => {
      seq = 0;
      const records = [
        send(1_000, "why is the sky blue?"),
        accepted(1_100, "t1", 1_100),
        status(1_200, "t1", "Thinking about light…"),
        delta(1_300, "t1", "Rayleigh "),
        delta(1_400, "t1", "scattering"),
        responded(2_000, "t1", 2_000),
      ];
      // Scrub to just after the second delta — before the terminal.
      const view = buildTimeTravelView({
        records,
        scrubSeq: 5,
        historyMessages: [],
      });
      expect(view).not.toBeNull();
      expect(view!.isTurnInFlight).toBe(true);
      expect(view!.signals.status).toBe("Thinking about light…");
      const roles = view!.messages.map((m) => m.role);
      expect(roles).toEqual(["user", "assistant"]);
      expect(view!.messages[1]!.parts).toEqual([
        { type: "text", text: "Rayleigh scattering" },
      ]);
    });
  });

  describe("scrubbed past the terminal", () => {
    it("shows the recorded final answer and a settled turn", () => {
      seq = 0;
      const records = [
        send(1_000, "why?"),
        accepted(1_100, "t1", 1_100),
        delta(1_300, "t1", "Rayleigh "),
        responded(2_000, "t1", 2_000),
      ];
      const view = buildTimeTravelView({
        records,
        scrubSeq: 4,
        historyMessages: [],
      });
      expect(view!.isTurnInFlight).toBe(false);
      const assistant = view!.messages.find((m) => m.role === "assistant");
      expect(assistant?.id).toBe("msg-t1");
      expect(assistant?.parts).toEqual([
        { type: "text", text: "the full answer" },
      ]);
      // The partial never double-renders alongside the settled answer.
      expect(
        view!.messages.filter((m) => m.role === "assistant"),
      ).toHaveLength(1);
    });

    it("dedupes the recorded answer against a history row with the same id", () => {
      seq = 0;
      const records = [responded(2_000, "t1", 2_000)];
      const view = buildTimeTravelView({
        records,
        scrubSeq: 1,
        historyMessages: [
          historyRow("msg-t1", "assistant", 1_999, "the full answer"),
        ],
      });
      expect(
        view!.messages.filter((m) => m.id === "msg-t1"),
      ).toHaveLength(1);
    });
  });

  describe("message ordering", () => {
    it("sorts a tape-only answer between its question and the next one", () => {
      // The regression: an answer recorded on the tape but not yet in the
      // history rows was appended after the WHOLE baseline — below questions
      // asked later. Settled messages merge on the shared server clock
      // (row.createdAtMs ≡ event.occurredAt), so it must sort in place.
      seq = 0;
      const records = [responded(2_500, "t1", 2_000)];
      const view = buildTimeTravelView({
        records,
        scrubSeq: 1,
        historyMessages: [
          historyRow("q1", "user", 1_000, "first question"),
          historyRow("q2", "user", 2_400, "second question"),
        ],
      });
      expect(view!.messages.map((m) => m.id)).toEqual(["q1", "msg-t1", "q2"]);
    });

    it("never duplicates a question the history already settled (clock skew)", () => {
      // The send's client timestamp can be AHEAD of the row's server
      // timestamp; the text guard keeps the settled row as the only copy.
      seq = 0;
      const records = [
        send(2_000, "same question"),
        accepted(2_100, "t1", 2_100),
        delta(2_200, "t1", "answer…"),
      ];
      const view = buildTimeTravelView({
        records,
        scrubSeq: 3,
        historyMessages: [historyRow("q1", "user", 1_500, "same question")],
      });
      expect(
        view!.messages.filter((m) => m.role === "user"),
      ).toHaveLength(1);
      expect(view!.messages[0]!.id).toBe("q1");
    });
  });

  describe("history beyond the moment", () => {
    it("hides rows created after the scrubbed instant", () => {
      seq = 0;
      const records = [send(1_000, "first")];
      const view = buildTimeTravelView({
        records,
        scrubSeq: 1,
        historyMessages: [
          historyRow("m-old", "assistant", 500, "before the moment"),
          historyRow("m-future", "assistant", 5_000, "after the moment"),
        ],
      });
      expect(view!.messages.map((m) => m.id)).toContain("m-old");
      expect(view!.messages.map((m) => m.id)).not.toContain("m-future");
    });
  });
});

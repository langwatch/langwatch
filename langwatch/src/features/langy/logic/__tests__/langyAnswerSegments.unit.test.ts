import { describe, expect, it } from "vitest";

import {
  hasLangyBlockParts,
  langyAnswerSegments,
} from "../langyAnswerSegments";

const text = (t: string) => ({ type: "text", text: t });
const cardPart = {
  type: "langy-card",
  blockId: "b1",
  kind: "stats",
  provenance: "derived",
  card: {
    kind: "stats",
    blockId: "b1",
    items: [{ label: "a", value: 1 }],
  },
};
const failedPart = {
  type: "langy-card-failed",
  blockId: "failed-block-1",
  raw: "not json",
};

describe("hasLangyBlockParts", () => {
  it("detects stamped and failed parts, and nothing else", () => {
    expect(hasLangyBlockParts([text("hi")])).toBe(false);
    expect(hasLangyBlockParts([text("hi"), cardPart])).toBe(true);
    expect(hasLangyBlockParts([failedPart])).toBe(true);
    expect(hasLangyBlockParts([{ type: "tool-bash" }])).toBe(false);
  });
});

describe("langyAnswerSegments", () => {
  describe("given prose around a stamped block", () => {
    it("keeps the card where the block sat in the reply's flow", () => {
      const segments = langyAnswerSegments([
        text("before"),
        cardPart,
        text("after"),
      ]);
      expect(segments.map((s) => s.type)).toEqual(["text", "card", "text"]);
      expect(segments[0]).toEqual({ type: "text", text: "before" });
      expect(segments[1]).toMatchObject({
        type: "card",
        part: { blockId: "b1" },
      });
    });
  });

  describe("given consecutive text parts", () => {
    it("joins them with a paragraph break so a headline can never glue to the reply", () => {
      const segments = langyAnswerSegments([
        text("one "),
        text("two"),
        cardPart,
      ]);
      expect(segments[0]).toEqual({ type: "text", text: "one \n\ntwo" });
    });
  });

  describe("given a text part that happens to contain a fence", () => {
    it("keeps it as text — the browser never re-parses recorded prose", () => {
      const withFence = '```langy-card\n{"kind": "stats"}\n```';
      const segments = langyAnswerSegments([text(withFence), cardPart]);
      expect(segments[0]).toEqual({ type: "text", text: withFence });
      expect(segments.filter((s) => s.type === "card")).toHaveLength(1);
    });
  });

  describe("given a failed part", () => {
    it("keeps the disclosure in place, carrying the raw text", () => {
      const segments = langyAnswerSegments([text("x"), failedPart]);
      expect(segments[1]).toEqual({ type: "failed", part: failedPart });
    });
  });

  describe("given a part claiming langy-card that does not parse", () => {
    it("degrades to a failed segment, never silence", () => {
      const malformed = { type: "langy-card", blockId: "b9" };
      const segments = langyAnswerSegments([malformed]);
      expect(segments).toHaveLength(1);
      expect(segments[0]).toMatchObject({
        type: "failed",
        part: { blockId: "malformed-part" },
      });
    });
  });

  describe("given tool parts among the prose", () => {
    it("leaves them out — they render through their own surfaces", () => {
      const segments = langyAnswerSegments([
        { type: "tool-bash", toolCallId: "t1" },
        text("prose"),
      ]);
      expect(segments).toEqual([{ type: "text", text: "prose" }]);
    });
  });

  describe("given whitespace-only prose between blocks", () => {
    it("drops the empty segment", () => {
      const segments = langyAnswerSegments([
        cardPart,
        text("\n\n"),
        failedPart,
      ]);
      expect(segments.map((s) => s.type)).toEqual(["card", "failed"]);
    });
  });
});

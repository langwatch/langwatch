import { deriveLangyChoicesLockState } from "@langwatch/langy";
import { describe, expect, it } from "vitest";

import { langyChoicesTimeline } from "../langyChoicesTimeline";

const questionPart = (blockId: string) => ({
  type: "langy-card",
  blockId,
  kind: "choices",
  provenance: "derived",
  card: {
    kind: "choices",
    blockId,
    question: "Which agent?",
    options: [{ id: "a", label: "A" }],
  },
});

const selectionPart = (blockId: string, optionIds: string[]) => ({
  type: "langy-choice-selection",
  blockId,
  optionIds,
});

const userText = (text: string) => ({
  role: "user",
  parts: [{ type: "text", text }],
});

describe("langyChoicesTimeline", () => {
  describe("given an assistant reply ending in a question", () => {
    it("contributes a question entry, not a message entry", () => {
      const timeline = langyChoicesTimeline([
        userText("run a scenario"),
        {
          role: "assistant",
          parts: [{ type: "text", text: "Which one?" }, questionPart("q1")],
        },
      ]);
      expect(timeline).toEqual([
        { kind: "message" },
        { kind: "question", blockId: "q1" },
      ]);
      // Its own prose never supersedes its own question.
      expect(
        deriveLangyChoicesLockState({ blockId: "q1", timeline }),
      ).toEqual({ status: "open" });
    });
  });

  describe("given a user selection message", () => {
    it("contributes the selection, and the question derives answered", () => {
      const timeline = langyChoicesTimeline([
        { role: "assistant", parts: [questionPart("q1")] },
        {
          role: "user",
          parts: [
            selectionPart("q1", ["a"]),
            { type: "text", text: "Chose: A" },
          ],
        },
      ]);
      expect(timeline).toEqual([
        { kind: "question", blockId: "q1" },
        { kind: "selection", blockId: "q1", optionIds: ["a"] },
      ]);
      expect(
        deriveLangyChoicesLockState({ blockId: "q1", timeline }),
      ).toEqual({ status: "answered", optionIds: ["a"] });
    });
  });

  describe("given an ordinary message after the question", () => {
    it("supersedes it — event order, nothing else", () => {
      const timeline = langyChoicesTimeline([
        { role: "assistant", parts: [questionPart("q1")] },
        userText("actually, forget that"),
      ]);
      expect(
        deriveLangyChoicesLockState({ blockId: "q1", timeline }),
      ).toEqual({ status: "superseded" });
    });
  });

  describe("given two questions and one answer", () => {
    it("binds the answer to its exact question", () => {
      const timeline = langyChoicesTimeline([
        { role: "assistant", parts: [questionPart("q1")] },
        { role: "assistant", parts: [questionPart("q2")] },
        { role: "user", parts: [selectionPart("q2", ["a"])] },
      ]);
      expect(
        deriveLangyChoicesLockState({ blockId: "q2", timeline }),
      ).toEqual({ status: "answered", optionIds: ["a"] });
      expect(
        deriveLangyChoicesLockState({ blockId: "q1", timeline }),
      ).toEqual({ status: "superseded" });
    });
  });

  describe("given a malformed selection part", () => {
    it("counts the message as an ordinary exchange", () => {
      const timeline = langyChoicesTimeline([
        { role: "assistant", parts: [questionPart("q1")] },
        {
          role: "user",
          parts: [{ type: "langy-choice-selection", optionIds: [] }],
        },
      ]);
      expect(timeline[1]).toEqual({ kind: "message" });
      expect(
        deriveLangyChoicesLockState({ blockId: "q1", timeline }),
      ).toEqual({ status: "superseded" });
    });
  });
});

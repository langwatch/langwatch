import { describe, expect, it } from "vitest";

import {
  deriveLangyChoicesLockState,
  langyChoiceSelectionSchema,
  renderLangyChoiceSelectionText,
  type LangyChoicesTimelineEntry,
} from "./choices";

describe("langyChoiceSelectionSchema", () => {
  describe("given a picked option", () => {
    it("validates", () => {
      const parsed = langyChoiceSelectionSchema.safeParse({
        blockId: "b1",
        optionIds: ["staging"],
      });
      expect(parsed.success).toBe(true);
    });
  });

  describe("given a free-text Other answer with no option", () => {
    it("validates on the other-text alone", () => {
      const parsed = langyChoiceSelectionSchema.safeParse({
        blockId: "b1",
        optionIds: [],
        otherText: "run it against my local agent",
      });
      expect(parsed.success).toBe(true);
    });
  });

  describe("given a selection that answers nothing", () => {
    it("refuses an empty selection", () => {
      expect(
        langyChoiceSelectionSchema.safeParse({ blockId: "b1", optionIds: [] })
          .success,
      ).toBe(false);
    });

    it("refuses whitespace-only other-text", () => {
      expect(
        langyChoiceSelectionSchema.safeParse({
          blockId: "b1",
          optionIds: [],
          otherText: "   ",
        }).success,
      ).toBe(false);
    });
  });

  describe("given a selection without a blockId", () => {
    it("refuses it — the answer must bind to its exact question", () => {
      expect(
        langyChoiceSelectionSchema.safeParse({ optionIds: ["a"] }).success,
      ).toBe(false);
    });
  });
});

describe("deriveLangyChoicesLockState", () => {
  const question = (blockId: string): LangyChoicesTimelineEntry => ({
    kind: "question",
    blockId,
  });
  const selection = (
    blockId: string,
    optionIds: string[] = ["staging"],
  ): LangyChoicesTimelineEntry => ({ kind: "selection", blockId, optionIds });
  const message: LangyChoicesTimelineEntry = { kind: "message" };

  describe("when the question is the conversation's latest exchange", () => {
    it("derives open", () => {
      expect(
        deriveLangyChoicesLockState({
          blockId: "q1",
          timeline: [message, question("q1")],
        }),
      ).toEqual({ status: "open" });
    });
  });

  describe("when a selection for the question was recorded", () => {
    it("derives answered with the chosen options", () => {
      expect(
        deriveLangyChoicesLockState({
          blockId: "q1",
          timeline: [question("q1"), selection("q1", ["prod"])],
        }),
      ).toEqual({ status: "answered", optionIds: ["prod"] });
    });

    it("stays answered forever, however much follows", () => {
      expect(
        deriveLangyChoicesLockState({
          blockId: "q1",
          timeline: [question("q1"), selection("q1"), message, message],
        }),
      ).toEqual({ status: "answered", optionIds: ["staging"] });
    });

    it("carries the other-text when the answer used it", () => {
      expect(
        deriveLangyChoicesLockState({
          blockId: "q1",
          timeline: [
            question("q1"),
            {
              kind: "selection",
              blockId: "q1",
              optionIds: [],
              otherText: "my own",
            },
          ],
        }),
      ).toEqual({ status: "answered", optionIds: [], otherText: "my own" });
    });
  });

  describe("when the user moved on instead of answering", () => {
    it("derives superseded from event order alone", () => {
      expect(
        deriveLangyChoicesLockState({
          blockId: "q1",
          timeline: [question("q1"), message],
        }),
      ).toEqual({ status: "superseded" });
    });

    it("supersedes an earlier question when a newer one is asked", () => {
      expect(
        deriveLangyChoicesLockState({
          blockId: "q1",
          timeline: [question("q1"), question("q2")],
        }),
      ).toEqual({ status: "superseded" });
      expect(
        deriveLangyChoicesLockState({
          blockId: "q2",
          timeline: [question("q1"), question("q2")],
        }),
      ).toEqual({ status: "open" });
    });
  });

  describe("when two questions exist and one is answered", () => {
    it("binds the answer to its exact question, never the other", () => {
      const timeline = [question("q1"), question("q2"), selection("q2")];
      expect(
        deriveLangyChoicesLockState({ blockId: "q2", timeline }),
      ).toEqual({ status: "answered", optionIds: ["staging"] });
      expect(
        deriveLangyChoicesLockState({ blockId: "q1", timeline }),
      ).toEqual({ status: "superseded" });
    });
  });

  describe("when the question is not on the timeline at all", () => {
    it("derives superseded — nothing unrecorded is answerable", () => {
      expect(
        deriveLangyChoicesLockState({ blockId: "ghost", timeline: [message] }),
      ).toEqual({ status: "superseded" });
    });
  });

  describe("when the same question id was re-emitted", () => {
    it("judges from the last occurrence", () => {
      expect(
        deriveLangyChoicesLockState({
          blockId: "q1",
          timeline: [question("q1"), message, question("q1")],
        }),
      ).toEqual({ status: "open" });
    });
  });
});

describe("renderLangyChoiceSelectionText", () => {
  const labels = new Map([
    ["staging", "Staging agent"],
    ["prod", "Production agent"],
  ]);

  describe("given picked options", () => {
    it("renders their labels as plain words", () => {
      expect(
        renderLangyChoiceSelectionText({
          selection: { blockId: "b1", optionIds: ["staging", "prod"] },
          optionLabelById: labels,
        }),
      ).toBe("Chose: Staging agent, Production agent");
    });

    it("falls back to the id when a label is unknown", () => {
      expect(
        renderLangyChoiceSelectionText({
          selection: { blockId: "b1", optionIds: ["mystery"] },
          optionLabelById: labels,
        }),
      ).toBe("Chose: mystery");
    });
  });

  describe("given an Other answer", () => {
    it("renders the free text like any option", () => {
      expect(
        renderLangyChoiceSelectionText({
          selection: { blockId: "b1", optionIds: [], otherText: "my own way" },
          optionLabelById: labels,
        }),
      ).toBe("Chose: my own way");
    });
  });
});

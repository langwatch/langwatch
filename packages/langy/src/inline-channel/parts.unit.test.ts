import { describe, expect, it } from "vitest";

import {
  parseLangyCardFailedPart,
  parseLangyCardPart,
  parseLangyChoiceSelectionPart,
} from "./parts";

const stampedPart = {
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

describe("parseLangyCardPart", () => {
  describe("given the part the relay stamps", () => {
    it("parses it", () => {
      expect(parseLangyCardPart(stampedPart)).toMatchObject({
        blockId: "b1",
        kind: "stats",
      });
    });
  });

  describe("given a part whose identity disagrees with its card", () => {
    it("refuses a kind mismatch", () => {
      expect(
        parseLangyCardPart({ ...stampedPart, kind: "table" }),
      ).toBeNull();
    });

    it("refuses a blockId mismatch", () => {
      expect(
        parseLangyCardPart({ ...stampedPart, blockId: "other" }),
      ).toBeNull();
    });
  });

  describe("given a part without derived provenance", () => {
    it("refuses it — the chrome keys off this field", () => {
      expect(
        parseLangyCardPart({ ...stampedPart, provenance: "measured" }),
      ).toBeNull();
    });
  });

  describe("given an unrelated part", () => {
    it("returns null", () => {
      expect(parseLangyCardPart({ type: "text", text: "hi" })).toBeNull();
    });
  });
});

describe("parseLangyCardFailedPart", () => {
  it("parses the disclosure part with its raw text", () => {
    expect(
      parseLangyCardFailedPart({
        type: "langy-card-failed",
        blockId: "failed-block-1",
        raw: "not json",
      }),
    ).toEqual({
      type: "langy-card-failed",
      blockId: "failed-block-1",
      raw: "not json",
    });
  });

  it("returns null for anything else", () => {
    expect(parseLangyCardFailedPart(stampedPart)).toBeNull();
  });
});

describe("parseLangyChoiceSelectionPart", () => {
  it("parses a selection riding a user message", () => {
    expect(
      parseLangyChoiceSelectionPart({
        type: "langy-choice-selection",
        blockId: "q1",
        optionIds: ["staging"],
      }),
    ).toMatchObject({ blockId: "q1", optionIds: ["staging"] });
  });

  it("refuses a selection that answers nothing", () => {
    expect(
      parseLangyChoiceSelectionPart({
        type: "langy-choice-selection",
        blockId: "q1",
        optionIds: [],
      }),
    ).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import {
  langyInsightsCardPartsOf,
  parseLangyCardFailedPart,
  parseLangyCardPart,
  parseLangyChoiceSelectionPart,
} from "../parts.ts";

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
      expect(parseLangyCardPart({ ...stampedPart, kind: "table" })).toBeNull();
    });

    it("refuses a blockId mismatch", () => {
      expect(parseLangyCardPart({ ...stampedPart, blockId: "other" })).toBeNull();
    });
  });

  describe("given a part without derived provenance", () => {
    it("refuses it — the chrome keys off this field", () => {
      expect(parseLangyCardPart({ ...stampedPart, provenance: "measured" })).toBeNull();
    });
  });

  describe("given an unrelated part", () => {
    it("returns null", () => {
      expect(parseLangyCardPart({ type: "text", text: "hi" })).toBeNull();
    });
  });
});

describe("langyInsightsCardPartsOf", () => {
  const insightsCard = (blockId: string) => ({
    kind: "insights",
    blockId,
    findings: [{ title: "Checkout cost doubled", body: "Cost rose from 41 to 96.", tone: "bad" }],
  });
  const insightsPart = (blockId: string) => ({
    type: "langy-card",
    blockId,
    kind: "insights",
    provenance: "derived",
    card: insightsCard(blockId),
  });

  describe("given the parts of a settled answer", () => {
    /** @scenario "A reader takes an answer's findings from its stamped card" */
    it("hands back each insights card, in the answer's own order, and no other part", () => {
      const parts = [
        { type: "text", text: "I read the board." },
        insightsPart("first"),
        stampedPart,
        { type: "langy-card-failed", blockId: "failed-block-1", raw: "not json" },
        insightsPart("second"),
      ];

      expect(langyInsightsCardPartsOf(parts).map(({ card }) => card.blockId)).toEqual([
        "first",
        "second",
      ]);
    });

    it("hands back none for prose that only quotes a card", () => {
      const quoted = JSON.stringify(insightsCard("quoted"));

      expect(langyInsightsCardPartsOf([{ type: "text", text: quoted }])).toEqual([]);
    });

    it("takes no card whose part was not stamped as derived", () => {
      expect(langyInsightsCardPartsOf([{ ...insightsPart("b1"), provenance: "measured" }])).toEqual(
        [],
      );
    });

    /** @scenario "A card repaired from damaged JSON says so on its part" */
    it("keeps the mark of a card the relay had to repair", () => {
      const [whole, repaired] = langyInsightsCardPartsOf([
        insightsPart("whole"),
        { ...insightsPart("cut-off"), repaired: true },
      ]);

      expect(whole?.repaired).toBeUndefined();
      expect(repaired?.repaired).toBe(true);
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

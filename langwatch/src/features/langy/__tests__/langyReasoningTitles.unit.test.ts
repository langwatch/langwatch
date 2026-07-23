import { describe, expect, it } from "vitest";
import {
  foldReasoningTitles,
  stripReasoningTitles,
} from "../logic/langyReasoningTitles";

/**
 * The reasoning-summary fold (see logic/langyReasoningTitles.ts): a codex
 * turn's `**Headline**` thinking paragraphs leak into the settled answer text
 * ahead of the reply, with the last one glued straight onto the reply's first
 * word. The fold peels them for the completed receipt and leaves the reply
 * as clean prose.
 */

// The real dogfood shape: five standalone headlines, then one glued onto the
// answer ("…trace countsMostly Langy conversations…").
const LEAKED_TEXT = [
  "**Planning task execution strategy**",
  "",
  "**Starting batch trace search**",
  "",
  "**Adjusting langwatch output limits**",
  "",
  "**Planning JSON output with jq filtering**",
  "",
  "**Planning JSON query with jq**",
  "",
  "**Summarizing recent trace counts**Mostly Langy conversations and assistant responses.",
].join("\n");

describe("foldReasoningTitles", () => {
  describe("when the settled text opens with leaked headline paragraphs", () => {
    it("peels every standalone headline into the fold", () => {
      const fold = foldReasoningTitles({
        parts: [],
        text: LEAKED_TEXT,
        hasActivity: true,
      });
      expect(fold.titles).toEqual([
        "Planning task execution strategy",
        "Starting batch trace search",
        "Adjusting langwatch output limits",
        "Planning JSON output with jq filtering",
        "Planning JSON query with jq",
        "Summarizing recent trace counts",
      ]);
    });

    it("severs the glued headline so the reply starts as its own block", () => {
      const fold = foldReasoningTitles({
        parts: [],
        text: LEAKED_TEXT,
        hasActivity: true,
      });
      expect(fold.text).toBe(
        "Mostly Langy conversations and assistant responses.",
      );
    });
  });

  describe("when consecutive headlines glue to each other and to the reply", () => {
    it("peels the whole chain, verbatim from a recorded turn", () => {
      // Two reasoning segments with no tool call between them arrive as
      // `**a****b**`, and the reply glues straight onto the second — the
      // exact shape recorded in a dogfood conversation.
      const text = [
        "**Planning performance loading**",
        "",
        "**Planning bounded trace search**",
        "",
        "**Planning trace search with JSON output**",
        "",
        "**Evaluating trace search limitations****Summarizing mixed Langy and gateway traces**Returned traces mix Langy and gateway traffic.",
      ].join("\n");
      const fold = foldReasoningTitles({ parts: [], text, hasActivity: true });
      expect(fold.titles).toEqual([
        "Planning performance loading",
        "Planning bounded trace search",
        "Planning trace search with JSON output",
        "Evaluating trace search limitations",
        "Summarizing mixed Langy and gateway traces",
      ]);
      expect(fold.text).toBe("Returned traces mix Langy and gateway traffic.");
    });

    it("peels a glued headline pair even at the head of the text", () => {
      const text =
        "**Assessing data retrieval limits****Planning targeted trace queries**\n\nAll good.";
      const fold = foldReasoningTitles({ parts: [], text, hasActivity: true });
      expect(fold.titles).toEqual([
        "Assessing data retrieval limits",
        "Planning targeted trace queries",
      ]);
      expect(fold.text).toBe("All good.");
    });
  });

  describe("when the message carries reasoning-typed parts", () => {
    it("collects their headlines without touching the text", () => {
      const fold = foldReasoningTitles({
        parts: [
          { type: "reasoning", text: "Planning task execution strategy" },
          { type: "tool-bash", state: "output-available" },
          { type: "reasoning", text: "**Summarizing recent trace counts**" },
          {
            type: "text",
            text: "Mostly Langy conversations and assistant responses.",
          },
        ],
        text: "Mostly Langy conversations and assistant responses.",
        hasActivity: true,
      });
      expect(fold.titles).toEqual([
        "Planning task execution strategy",
        "Summarizing recent trace counts",
      ]);
      expect(fold.text).toBe(
        "Mostly Langy conversations and assistant responses.",
      );
    });
  });

  describe("when the turn has no activity record to fold into", () => {
    it("leaves the text untouched", () => {
      const fold = foldReasoningTitles({
        parts: [],
        text: LEAKED_TEXT,
        hasActivity: false,
      });
      expect(fold.text).toBe(LEAKED_TEXT);
      expect(fold.titles).toEqual([]);
    });
  });

  describe("when bold at the head is the model's own emphasis", () => {
    it("keeps a bold run that ends a sentence", () => {
      const text = "**Do not deploy on Friday.**\n\nHere is why.";
      const fold = foldReasoningTitles({ parts: [], text, hasActivity: true });
      expect(fold.titles).toEqual([]);
      expect(fold.text).toBe(text);
    });

    it("keeps a one-word bold heading", () => {
      const text = "**Summary**\n\nAll good.";
      const fold = foldReasoningTitles({ parts: [], text, hasActivity: true });
      expect(fold.titles).toEqual([]);
      expect(fold.text).toBe(text);
    });

    it("keeps a lone glued bold run with no standalone run before it", () => {
      const text = "**Very important** never rotate this key.";
      const fold = foldReasoningTitles({ parts: [], text, hasActivity: true });
      expect(fold.titles).toEqual([]);
      expect(fold.text).toBe(text);
    });

    it("keeps a bold run that sits mid-answer", () => {
      const text =
        "The traces look fine.\n\n**Planning next steps** is up to you.";
      const fold = foldReasoningTitles({ parts: [], text, hasActivity: true });
      expect(fold.titles).toEqual([]);
      expect(fold.text).toBe(text);
    });
  });

  describe("when the whole answer is headline paragraphs", () => {
    it("returns the original text rather than an empty reply", () => {
      const text =
        "**Planning task execution strategy**\n\n**Starting batch trace search**";
      const fold = foldReasoningTitles({ parts: [], text, hasActivity: true });
      expect(fold.titles).toEqual([]);
      expect(fold.text).toBe(text);
    });
  });
});

describe("stripReasoningTitles", () => {
  describe("when a prose segment opens with the leaked headlines", () => {
    it("returns only the reply text", () => {
      expect(
        stripReasoningTitles({ text: LEAKED_TEXT, hasActivity: true }),
      ).toBe("Mostly Langy conversations and assistant responses.");
    });
  });

  describe("when the turn has no activity record", () => {
    it("returns the text untouched", () => {
      expect(
        stripReasoningTitles({ text: LEAKED_TEXT, hasActivity: false }),
      ).toBe(LEAKED_TEXT);
    });
  });
});

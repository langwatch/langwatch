import { describe, expect, it } from "vitest";

import { mightContainLangyCardFence, splitLangyCardFences } from "./fence";

describe("splitLangyCardFences", () => {
  describe("given plain prose", () => {
    it("returns one text segment, verbatim", () => {
      expect(splitLangyCardFences("hello\nworld")).toEqual([
        { type: "text", text: "hello\nworld" },
      ]);
    });

    it("returns nothing for empty text", () => {
      expect(splitLangyCardFences("")).toEqual([]);
    });
  });

  describe("given a block between prose", () => {
    it("keeps the prose as prose and the fence content as a fence", () => {
      const text = [
        "Here is the plot:",
        "```langy-card",
        '{"kind": "stats"}',
        "```",
        "And that is that.",
      ].join("\n");
      expect(splitLangyCardFences(text)).toEqual([
        { type: "text", text: "Here is the plot:" },
        { type: "fence", raw: '{"kind": "stats"}', closed: true },
        { type: "text", text: "And that is that." },
      ]);
    });

    it("handles a reply that is only a fence", () => {
      const text = ["```langy-card", "{}", "```"].join("\n");
      expect(splitLangyCardFences(text)).toEqual([
        { type: "fence", raw: "{}", closed: true },
      ]);
    });

    it("keeps multi-line fence content joined as it streamed", () => {
      const text = ["```langy-card", "{", '  "kind": "table"', "}", "```"].join(
        "\n",
      );
      expect(splitLangyCardFences(text)).toEqual([
        { type: "fence", raw: '{\n  "kind": "table"\n}', closed: true },
      ]);
    });
  });

  describe("given several blocks in one reply", () => {
    it("returns them in document order", () => {
      const text = [
        "First:",
        "```langy-card",
        "{1}",
        "```",
        "Second:",
        "```langy-card",
        "{2}",
        "```",
      ].join("\n");
      expect(splitLangyCardFences(text)).toEqual([
        { type: "text", text: "First:" },
        { type: "fence", raw: "{1}", closed: true },
        { type: "text", text: "Second:" },
        { type: "fence", raw: "{2}", closed: true },
      ]);
    });
  });

  describe("given a fence still open at the end of the text", () => {
    it("reports it unclosed — the forming-block case", () => {
      const text = ["Prose first.", "```langy-card", '{"kind": "sta'].join(
        "\n",
      );
      expect(splitLangyCardFences(text)).toEqual([
        { type: "text", text: "Prose first." },
        { type: "fence", raw: '{"kind": "sta', closed: false },
      ]);
    });
  });

  describe("given a langy-card fence quoted inside another code block", () => {
    it("keeps it as literal text — a quoted fence never becomes a block", () => {
      const text = [
        "You would write:",
        "````markdown",
        "```langy-card",
        '{"kind": "stats"}',
        "```",
        "````",
        "like so.",
      ].join("\n");
      expect(splitLangyCardFences(text)).toEqual([
        { type: "text", text },
      ]);
    });

    it("treats an ordinary json fence as opaque text", () => {
      const text = ["```json", '{"a": 1}', "```", "done"].join("\n");
      expect(splitLangyCardFences(text)).toEqual([{ type: "text", text }]);
    });
  });

  describe("given a stray closing fence in prose", () => {
    it("keeps it as text", () => {
      const text = ["odd but fine:", "```", "still text"].join("\n");
      expect(splitLangyCardFences(text)).toEqual([{ type: "text", text }]);
    });
  });

  describe("given an opening fence written loosely", () => {
    it("opens a block for a space between the backticks and the tag", () => {
      const text = ["``` langy-card", '{"kind": "stats"}', "```"].join("\n");
      expect(splitLangyCardFences(text)).toEqual([
        { type: "fence", raw: '{"kind": "stats"}', closed: true },
      ]);
    });

    it("opens a block for an indented fence", () => {
      const text = ["   ```langy-card", '{"kind": "stats"}', "```"].join("\n");
      expect(splitLangyCardFences(text)).toEqual([
        { type: "fence", raw: '{"kind": "stats"}', closed: true },
      ]);
    });
  });
});

/**
 * The pre-scan exists to let a fence-less stream skip the line scan, so the
 * one thing it must never do is answer false for text the splitter would
 * open a block in. A caller that guesses this with its own substring test
 * misses the loose forms above and shows the reader a card's JSON as a code
 * block, which is exactly what the gate was meant to be too cheap to get
 * wrong.
 */
describe("mightContainLangyCardFence", () => {
  const opensABlock = (text: string): boolean =>
    splitLangyCardFences(text).some((segment) => segment.type === "fence");

  describe("given text the splitter opens a block in", () => {
    /** @scenario "The pre-scan accepts every opening the grammar accepts" */
    it.each([
      ["the plain form", "```langy-card"],
      ["a space before the tag", "``` langy-card"],
      ["a tab before the tag", "```\tlangy-card"],
      ["an indented fence", "   ```langy-card"],
      ["four backticks", "````langy-card"],
      ["trailing space after the tag", "```langy-card "],
    ])("answers true for %s", (_name, opening) => {
      const text = [opening, '{"kind": "stats"}', "```"].join("\n");
      expect(opensABlock(text)).toBe(true);
      expect(mightContainLangyCardFence(text)).toBe(true);
    });
  });

  describe("given text with no block in it", () => {
    it("stays false for prose, so the fast path keeps paying", () => {
      expect(mightContainLangyCardFence("no blocks here\n```json\n{}\n```")).toBe(
        false,
      );
    });
  });
});

import { describe, expect, it } from "vitest";

import { RAW_COLOUR_HINT_MESSAGE, rawColourHints } from "../widget-colour-hints.ts";

describe("rawColourHints", () => {
  describe("given widget code with a quoted hex colour", () => {
    const source = `const C = 1;\nconst colours = [C, "#9f7aea"];`;

    /** @scenario "A quoted hex colour is hinted" */
    it("hints the hex with its line, column and the palette message", () => {
      expect(rawColourHints(source)).toEqual([
        {
          line: 2,
          column: 22,
          length: 7,
          hex: "#9f7aea",
          message: RAW_COLOUR_HINT_MESSAGE,
        },
      ]);
    });
  });

  describe("given a hex colour inside a longer string or template literal", () => {
    /** @scenario "A hex colour inside a longer string is hinted" */
    it("hints each hex and skips the text around it", () => {
      const source = `const border = "1px solid #e4e4e7";\nconst tone = \`\${x} #9f7aea\`;`;
      expect(rawColourHints(source).map((hint) => [hint.line, hint.hex])).toEqual([
        [1, "#e4e4e7"],
        [2, "#9f7aea"],
      ]);
    });
  });

  describe("given hex-like tokens of each length", () => {
    it("hints 3, 4, 6 and 8 digit colours only", () => {
      const hexes = ["#abc", "#abcd", "#aabbcc", "#aabbccdd"];
      const hinted = rawColourHints(hexes.map((hex) => `"${hex}"`).join("\n"));
      expect(hinted.map((hint) => hint.hex)).toEqual(hexes);
    });

    it("ignores 5 and 7 digit tokens and a hex run on into a word", () => {
      expect(rawColourHints(`"#12345" "#1234567" "#abcdefg"`)).toEqual([]);
    });
  });

  describe("given a hex colour inside a comment", () => {
    /** @scenario "Hex colours in comments are not hinted" */
    it("skips // line comments and block comments", () => {
      const source = `// "#9f7aea"\n/* "#e4e4e7"\n "#0d9488" */\nconst x = 1;`;
      expect(rawColourHints(source)).toEqual([]);
    });
  });

  describe("given an apostrophe in JSX text above a hex colour", () => {
    it("still hints the colour on the next line", () => {
      const source = `<p>Don't read this</p>\nconst c = "#9f7aea";`;
      expect(rawColourHints(source).map((hint) => [hint.line, hint.hex])).toEqual([[2, "#9f7aea"]]);
    });
  });

  describe("given widget code that reads LW.palette only", () => {
    /** @scenario "Source that reads LW.palette gets no colour hint" */
    it("raises no hint", () => {
      expect(rawColourHints(`const RAMP = LW.palette.series;`)).toEqual([]);
    });
  });

  describe("given CSS written unquoted inside a template string", () => {
    it("does not hint it, since only string literals are colours the author chose", () => {
      expect(rawColourHints("outline: 2px solid #0d9488;")).toEqual([]);
    });
  });
});
